-- Up Migration
-- identity schema: accounts, sessions, audit trail, personal-data masking.

CREATE TABLE identity.roles (
  role_id smallint PRIMARY KEY,
  code    text NOT NULL UNIQUE CHECK (code ~ '^[a-z_]+$'),
  name    text NOT NULL
);
COMMENT ON TABLE identity.roles IS 'Reference: application roles (seeded from db/seed/reference).';

CREATE TABLE identity.audit_event_types (
  event_type_id smallint PRIMARY KEY,
  code          text NOT NULL UNIQUE CHECK (code ~ '^[a-z_]+$'),
  description   text NOT NULL
);
COMMENT ON TABLE identity.audit_event_types IS 'Reference: kinds of security-relevant events.';

CREATE TABLE identity.users (
  user_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL,
  password_hash     text   NOT NULL,
  display_name      text,
  role_id           smallint NOT NULL DEFAULT 1 REFERENCES identity.roles (role_id),
  locale            text NOT NULL DEFAULT 'en',
  email_verified_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT users_email_format  CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT users_password_algo CHECK (password_hash LIKE '$argon2id$%'),
  CONSTRAINT users_display_name  CHECK (char_length(display_name) BETWEEN 1 AND 80),
  CONSTRAINT users_locale        CHECK (locale IN ('en', 'pl', 'lt', 'ru'))
);
CREATE UNIQUE INDEX users_email_uq ON identity.users (email);
CREATE INDEX users_role_idx ON identity.users (role_id);
COMMENT ON TABLE  identity.users IS 'User accounts. Contains personal data: email, display_name.';
COMMENT ON COLUMN identity.users.email IS 'PII. Case-insensitive, unique. Masked in v_users_masked.';
COMMENT ON COLUMN identity.users.password_hash IS 'Argon2id PHC string. Plain passwords never reach the database.';
COMMENT ON COLUMN identity.users.display_name IS 'PII. Optional name shown in the UI.';
COMMENT ON COLUMN identity.users.deleted_at IS 'Set by anonymize_user(); the row stays as a tombstone without personal data.';

CREATE TABLE identity.refresh_tokens (
  token_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES identity.users (user_id) ON DELETE CASCADE,
  token_hash  bytea NOT NULL UNIQUE,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid REFERENCES identity.refresh_tokens (token_id) ON DELETE SET NULL,
  user_agent  text,
  ip          inet,
  CONSTRAINT refresh_tokens_hash_len CHECK (octet_length(token_hash) = 32),
  CONSTRAINT refresh_tokens_expiry   CHECK (expires_at > issued_at)
);
CREATE INDEX refresh_tokens_user_live_idx ON identity.refresh_tokens (user_id) WHERE revoked_at IS NULL;
CREATE INDEX refresh_tokens_expires_idx ON identity.refresh_tokens (expires_at);
COMMENT ON TABLE  identity.refresh_tokens IS 'Rotating refresh tokens (one row per issued token).';
COMMENT ON COLUMN identity.refresh_tokens.token_hash IS 'SHA-256 of a random 256-bit token. The token itself is never stored.';
COMMENT ON COLUMN identity.refresh_tokens.ip IS 'PII. Cleared by anonymize_user().';

CREATE TABLE identity.audit_log (
  audit_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       uuid REFERENCES identity.users (user_id) ON DELETE SET NULL,
  event_type_id smallint NOT NULL REFERENCES identity.audit_event_types (event_type_id),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  ip            inet,
  db_actor      name NOT NULL DEFAULT session_user
);
CREATE INDEX audit_log_user_idx ON identity.audit_log (user_id, occurred_at DESC);
CREATE INDEX audit_log_time_idx ON identity.audit_log USING brin (occurred_at);
COMMENT ON TABLE identity.audit_log IS 'Append-only security log. Service role can INSERT and SELECT only.';
REVOKE UPDATE, DELETE ON identity.audit_log FROM identity_rw;

CREATE TABLE identity.outbox (
  event_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   text NOT NULL CHECK (event_type ~ '^[a-z]+(\.[a-z_]+)+\.v[0-9]+$'),
  payload      jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished_idx ON identity.outbox (occurred_at) WHERE published_at IS NULL;
COMMENT ON TABLE  identity.outbox IS 'Transactional outbox: events written in the same transaction as the state change.';
COMMENT ON COLUMN identity.outbox.payload IS 'Event body. JSON is justified: structure is defined per event_type in contracts/asyncapi.';

-- ------------------------------------------------------------ functions
CREATE FUNCTION identity.mask_email(p_email citext) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN p_email IS NULL THEN NULL
              ELSE left(p_email::text, 1) || '***@' || split_part(p_email::text, '@', 2) END
$$;
COMMENT ON FUNCTION identity.mask_email(citext) IS 'jan.kowalski@example.com -> j***@example.com';

CREATE FUNCTION identity.mask_name(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN p_name IS NULL THEN NULL ELSE left(p_name, 1) || '***' END
$$;

CREATE FUNCTION identity.tg_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE FUNCTION identity.tg_users_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_code text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_code := 'user_registered';
  ELSIF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    v_code := 'user_anonymized';
  ELSIF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    v_code := 'password_changed';
  ELSIF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    v_code := 'role_changed';
  ELSIF (NEW.email, NEW.display_name, NEW.locale) IS DISTINCT FROM (OLD.email, OLD.display_name, OLD.locale) THEN
    v_code := 'profile_updated';
  ELSE
    RETURN NULL;
  END IF;
  INSERT INTO identity.audit_log (user_id, event_type_id)
  SELECT NEW.user_id, event_type_id FROM identity.audit_event_types WHERE code = v_code;
  RETURN NULL;
END $$;

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON identity.users
  FOR EACH ROW EXECUTE FUNCTION identity.tg_set_updated_at();
CREATE TRIGGER users_audit AFTER INSERT OR UPDATE ON identity.users
  FOR EACH ROW EXECUTE FUNCTION identity.tg_users_audit();

-- Right to erasure. One transaction: scrub PII, end sessions, emit event.
CREATE PROCEDURE identity.anonymize_user(p_user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = identity, public, pg_temp AS $$
BEGIN
  UPDATE identity.users
     SET email = ('deleted-' || user_id || '@invalid.example')::citext,
         display_name = NULL,
         password_hash = '$argon2id$disabled',
         email_verified_at = NULL,
         deleted_at = now()
   WHERE user_id = p_user_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user % not found or already anonymized', p_user_id USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM identity.refresh_tokens WHERE user_id = p_user_id;
  UPDATE identity.audit_log SET ip = NULL WHERE user_id = p_user_id;  -- needs owner rights
  INSERT INTO identity.outbox (event_type, payload)
  VALUES ('identity.user.deleted.v1', jsonb_build_object('userId', p_user_id));
END $$;
COMMENT ON PROCEDURE identity.anonymize_user(uuid) IS 'Removes personal data of one user and publishes identity.user.deleted.v1 via the outbox.';

-- ------------------------------------------------------------ views
CREATE VIEW identity.v_users_masked AS
SELECT u.user_id,
       identity.mask_email(u.email)       AS email_masked,
       identity.mask_name(u.display_name) AS display_name_masked,
       r.code                             AS role_code,
       u.locale,
       u.email_verified_at IS NOT NULL    AS is_verified,
       u.deleted_at IS NOT NULL           AS is_deleted,
       date_trunc('day', u.created_at)    AS created_day
FROM identity.users u
JOIN identity.roles r USING (role_id);
COMMENT ON VIEW identity.v_users_masked IS 'Users without readable personal data. The only users relation visible to app_read.';

CREATE VIEW identity.v_audit_masked AS
SELECT a.audit_id, a.user_id, t.code AS event_code, a.occurred_at,
       CASE WHEN a.ip IS NULL THEN NULL
            WHEN family(a.ip) = 4 THEN network(set_masklen(a.ip, 24))::text
            ELSE network(set_masklen(a.ip, 48))::text END AS ip_masked
FROM identity.audit_log a
JOIN identity.audit_event_types t USING (event_type_id);
COMMENT ON VIEW identity.v_audit_masked IS 'Audit log with IP truncated to /24 (IPv4) or /48 (IPv6).';

GRANT SELECT ON identity.roles, identity.audit_event_types,
                identity.v_users_masked, identity.v_audit_masked TO app_read;

-- Down Migration
DROP VIEW identity.v_audit_masked;
DROP VIEW identity.v_users_masked;
DROP PROCEDURE identity.anonymize_user(uuid);
DROP TABLE identity.outbox, identity.audit_log, identity.refresh_tokens, identity.users,
           identity.audit_event_types, identity.roles;
DROP FUNCTION identity.tg_users_audit();
DROP FUNCTION identity.tg_set_updated_at();
DROP FUNCTION identity.mask_name(text);
DROP FUNCTION identity.mask_email(citext);
