-- Up Migration
-- places schema: geocoding cache, saved places, search history.
-- saved_places and search_history contain personal data (addresses tied to a user).

CREATE DOMAIN places.h3_cell AS text CHECK (VALUE ~ '^8[0-9a-f]{14}$');
CREATE DOMAIN places.city_code AS text CHECK (VALUE ~ '^[a-z]{3}$');

CREATE TABLE places.place_kinds (
  kind_id smallint PRIMARY KEY,
  code    text NOT NULL UNIQUE CHECK (code ~ '^[a-z_]+$'),
  label   text NOT NULL
);
COMMENT ON TABLE places.place_kinds IS 'Reference: home, work, study, other.';

CREATE TABLE places.geocode_cache (
  geocode_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  city_code    places.city_code NOT NULL,
  query_norm   text NOT NULL,
  display_name text NOT NULL,
  geom         geography(Point, 4326) NOT NULL,
  provider     text NOT NULL CHECK (provider IN ('photon', 'nominatim', 'pelias')),
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  CONSTRAINT geocode_cache_query_uq UNIQUE (city_code, query_norm),
  CONSTRAINT geocode_cache_norm CHECK (query_norm = lower(btrim(query_norm)) AND char_length(query_norm) BETWEEN 3 AND 200),
  CONSTRAINT geocode_cache_expiry CHECK (expires_at > fetched_at)
);
CREATE INDEX geocode_cache_expires_idx ON places.geocode_cache (expires_at);
COMMENT ON TABLE places.geocode_cache IS 'Best geocoder answer per normalized query. Not linked to users, so not personal data.';

CREATE TABLE places.saved_places (
  place_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  kind_id      smallint NOT NULL REFERENCES places.place_kinds (kind_id),
  label        text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  address_text text NOT NULL CHECK (char_length(address_text) BETWEEN 3 AND 300),
  city_code    places.city_code NOT NULL,
  geom         geography(Point, 4326) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_places_label_uq UNIQUE (user_id, label)
);
COMMENT ON TABLE  places.saved_places IS 'Addresses a user keeps. PII: label, address_text, geom.';
COMMENT ON COLUMN places.saved_places.user_id IS 'Logical reference to identity.users (no cross-schema FK); rows are removed on identity.user.deleted.v1.';

CREATE TABLE places.search_history (
  history_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid NOT NULL,
  calculation_id uuid NOT NULL,
  city_code      places.city_code NOT NULL,
  origin_h3      places.h3_cell NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT search_history_uq UNIQUE (user_id, calculation_id)
);
CREATE INDEX search_history_user_idx ON places.search_history (user_id, created_at DESC);
COMMENT ON TABLE places.search_history IS 'Maps a signed-in user asked for. Filled from accessibility.calculation.completed.v1. PII: user_id with origin_h3.';

CREATE TABLE places.processed_messages (
  message_id   uuid PRIMARY KEY,
  event_type   text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------ triggers
CREATE FUNCTION places.tg_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER saved_places_set_updated_at BEFORE UPDATE ON places.saved_places
  FOR EACH ROW EXECUTE FUNCTION places.tg_set_updated_at();

-- Business rule: at most 20 saved places per user.
CREATE FUNCTION places.tg_saved_places_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));
  IF (SELECT count(*) FROM places.saved_places WHERE user_id = NEW.user_id) >= 20 THEN
    RAISE EXCEPTION 'user % already has 20 saved places', NEW.user_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER saved_places_limit BEFORE INSERT ON places.saved_places
  FOR EACH ROW EXECUTE FUNCTION places.tg_saved_places_limit();

-- Keep the latest 50 history rows per user.
CREATE FUNCTION places.tg_search_history_trim() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM places.search_history
   WHERE user_id = NEW.user_id
     AND history_id IN (SELECT history_id FROM places.search_history
                        WHERE user_id = NEW.user_id ORDER BY created_at DESC, history_id DESC OFFSET 50);
  RETURN NULL;
END $$;
CREATE TRIGGER search_history_trim AFTER INSERT ON places.search_history
  FOR EACH ROW EXECUTE FUNCTION places.tg_search_history_trim();

-- ------------------------------------------------------------ functions
CREATE FUNCTION places.erase_user(p_user_id uuid) RETURNS integer
LANGUAGE sql AS $$
  WITH a AS (DELETE FROM places.saved_places   WHERE user_id = p_user_id RETURNING 1),
       b AS (DELETE FROM places.search_history WHERE user_id = p_user_id RETURNING 1)
  SELECT ((SELECT count(*) FROM a) + (SELECT count(*) FROM b))::int;
$$;
COMMENT ON FUNCTION places.erase_user(uuid) IS 'Removes everything stored about a user. Called by the consumer of identity.user.deleted.v1.';

-- ------------------------------------------------------------ masked views
CREATE VIEW places.v_saved_places_masked AS
SELECT p.place_id,
       left(encode(sha256(p.user_id::text::bytea), 'hex'), 12) AS user_pseudonym,
       k.code AS kind_code,
       p.city_code,
       round(ST_Y(p.geom::geometry)::numeric, 2) AS lat_approx,
       round(ST_X(p.geom::geometry)::numeric, 2) AS lon_approx,
       date_trunc('day', p.created_at) AS created_day
FROM places.saved_places p
JOIN places.place_kinds k USING (kind_id);
COMMENT ON VIEW places.v_saved_places_masked IS 'Saved places without label or address; user pseudonymised, coordinates rounded to ~1 km.';

CREATE VIEW places.v_search_stats AS
SELECT date_trunc('day', created_at)::date AS day, city_code,
       count(*) AS searches, count(DISTINCT user_id) AS users
FROM places.search_history
GROUP BY 1, 2;
COMMENT ON VIEW places.v_search_stats IS 'Aggregated history: no user identifiers, no locations.';

GRANT SELECT ON places.place_kinds, places.geocode_cache,
                places.v_saved_places_masked, places.v_search_stats TO app_read;

-- Down Migration
DROP VIEW places.v_search_stats;
DROP VIEW places.v_saved_places_masked;
DROP FUNCTION places.erase_user(uuid);
DROP TABLE places.processed_messages, places.search_history, places.saved_places,
           places.geocode_cache, places.place_kinds;
DROP FUNCTION places.tg_search_history_trim();
DROP FUNCTION places.tg_saved_places_limit();
DROP FUNCTION places.tg_set_updated_at();
DROP DOMAIN places.city_code;
DROP DOMAIN places.h3_cell;
