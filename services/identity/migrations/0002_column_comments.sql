-- Up Migration
-- Descriptions for every column (and table) that had none, so the data dictionary is complete.

COMMENT ON TABLE  identity.pgmigrations IS 'Migration history of the identity schema, maintained by node-pg-migrate.';
COMMENT ON COLUMN identity.pgmigrations.id IS 'Surrogate key in the order migrations were applied.';
COMMENT ON COLUMN identity.pgmigrations.name IS 'Migration file name without extension, e.g. 0001_init.';
COMMENT ON COLUMN identity.pgmigrations.run_on IS 'When the migration was applied (server local time).';

COMMENT ON COLUMN identity.roles.role_id IS 'Stable numeric id referenced by users.role_id (1 = user, 2 = admin).';
COMMENT ON COLUMN identity.roles.code IS 'Machine name used in tokens and access checks (user, admin).';
COMMENT ON COLUMN identity.roles.name IS 'Human-readable name.';

COMMENT ON COLUMN identity.audit_event_types.event_type_id IS 'Stable numeric id referenced by audit_log.event_type_id.';
COMMENT ON COLUMN identity.audit_event_types.code IS 'Machine name of the event, e.g. login_failed.';
COMMENT ON COLUMN identity.audit_event_types.description IS 'What the event means.';

COMMENT ON COLUMN identity.users.user_id IS 'Account id; exposed in tokens and used by other services as a logical reference.';
COMMENT ON COLUMN identity.users.role_id IS 'Access level of the account.';
COMMENT ON COLUMN identity.users.locale IS 'Preferred UI language (en, pl, lt, ru).';
COMMENT ON COLUMN identity.users.email_verified_at IS 'When the email address was confirmed; NULL = not confirmed.';
COMMENT ON COLUMN identity.users.created_at IS 'Registration time.';
COMMENT ON COLUMN identity.users.updated_at IS 'Last change of the row; maintained by trigger users_set_updated_at.';

COMMENT ON COLUMN identity.refresh_tokens.token_id IS 'Token row id (also the jti of the refresh token).';
COMMENT ON COLUMN identity.refresh_tokens.user_id IS 'Owner of the session.';
COMMENT ON COLUMN identity.refresh_tokens.issued_at IS 'When the token was issued.';
COMMENT ON COLUMN identity.refresh_tokens.expires_at IS 'After this moment the token is rejected.';
COMMENT ON COLUMN identity.refresh_tokens.revoked_at IS 'Set on rotation, logout or reuse detection; NULL = live.';
COMMENT ON COLUMN identity.refresh_tokens.replaced_by IS 'Token issued in exchange for this one on rotation; using a replaced token is reuse.';
COMMENT ON COLUMN identity.refresh_tokens.user_agent IS 'Client User-Agent at issue time, for the session list.';

COMMENT ON COLUMN identity.audit_log.audit_id IS 'Sequential id of the entry.';
COMMENT ON COLUMN identity.audit_log.user_id IS 'Account the event is about; NULL when unknown (e.g. failed login for an unknown email).';
COMMENT ON COLUMN identity.audit_log.event_type_id IS 'Kind of event.';
COMMENT ON COLUMN identity.audit_log.occurred_at IS 'When the event happened.';
COMMENT ON COLUMN identity.audit_log.ip IS 'PII. Client address; masked in v_audit_masked, cleared by anonymize_user().';
COMMENT ON COLUMN identity.audit_log.db_actor IS 'Database role that wrote the entry (session_user).';

COMMENT ON COLUMN identity.outbox.event_id IS 'Message id; consumers use it for deduplication.';
COMMENT ON COLUMN identity.outbox.event_type IS 'Routing key, e.g. identity.user.deleted.v1.';
COMMENT ON COLUMN identity.outbox.occurred_at IS 'When the state change happened.';
COMMENT ON COLUMN identity.outbox.published_at IS 'When the broker confirmed the message; NULL = pending.';

-- routines
COMMENT ON FUNCTION identity.mask_name(text) IS 'Masks a display name: Jan -> J***.';
COMMENT ON FUNCTION identity.tg_set_updated_at() IS 'Trigger: sets updated_at to now() on every update.';
COMMENT ON FUNCTION identity.tg_users_audit() IS 'Trigger: writes one audit_log row for registration, password, role, profile change or anonymisation.';

-- Down Migration
COMMENT ON FUNCTION identity.tg_users_audit() IS NULL;
COMMENT ON FUNCTION identity.tg_set_updated_at() IS NULL;
COMMENT ON FUNCTION identity.mask_name(text) IS NULL;
COMMENT ON COLUMN identity.outbox.published_at IS NULL;
COMMENT ON COLUMN identity.outbox.occurred_at IS NULL;
COMMENT ON COLUMN identity.outbox.event_type IS NULL;
COMMENT ON COLUMN identity.outbox.event_id IS NULL;
COMMENT ON COLUMN identity.audit_log.db_actor IS NULL;
COMMENT ON COLUMN identity.audit_log.ip IS NULL;
COMMENT ON COLUMN identity.audit_log.occurred_at IS NULL;
COMMENT ON COLUMN identity.audit_log.event_type_id IS NULL;
COMMENT ON COLUMN identity.audit_log.user_id IS NULL;
COMMENT ON COLUMN identity.audit_log.audit_id IS NULL;
COMMENT ON COLUMN identity.refresh_tokens.user_agent IS NULL;
COMMENT ON COLUMN identity.refresh_tokens.replaced_by IS NULL;
COMMENT ON COLUMN identity.refresh_tokens.revoked_at IS NULL;
COMMENT ON COLUMN identity.refresh_tokens.expires_at IS NULL;
COMMENT ON COLUMN identity.refresh_tokens.issued_at IS NULL;
COMMENT ON COLUMN identity.refresh_tokens.user_id IS NULL;
COMMENT ON COLUMN identity.refresh_tokens.token_id IS NULL;
COMMENT ON COLUMN identity.users.updated_at IS NULL;
COMMENT ON COLUMN identity.users.created_at IS NULL;
COMMENT ON COLUMN identity.users.email_verified_at IS NULL;
COMMENT ON COLUMN identity.users.locale IS NULL;
COMMENT ON COLUMN identity.users.role_id IS NULL;
COMMENT ON COLUMN identity.users.user_id IS NULL;
COMMENT ON COLUMN identity.audit_event_types.description IS NULL;
COMMENT ON COLUMN identity.audit_event_types.code IS NULL;
COMMENT ON COLUMN identity.audit_event_types.event_type_id IS NULL;
COMMENT ON COLUMN identity.roles.name IS NULL;
COMMENT ON COLUMN identity.roles.code IS NULL;
COMMENT ON COLUMN identity.roles.role_id IS NULL;
COMMENT ON COLUMN identity.pgmigrations.run_on IS NULL;
COMMENT ON COLUMN identity.pgmigrations.name IS NULL;
COMMENT ON COLUMN identity.pgmigrations.id IS NULL;
COMMENT ON TABLE  identity.pgmigrations IS NULL;
