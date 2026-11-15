-- Up Migration
-- Descriptions for every column (and table) that had none, so the data dictionary is complete.

COMMENT ON TABLE  places.pgmigrations IS 'Migration history of the places schema, maintained by node-pg-migrate.';
COMMENT ON COLUMN places.pgmigrations.id IS 'Surrogate key in the order migrations were applied.';
COMMENT ON COLUMN places.pgmigrations.name IS 'Migration file name without extension, e.g. 0001_init.';
COMMENT ON COLUMN places.pgmigrations.run_on IS 'When the migration was applied (server local time).';

COMMENT ON COLUMN places.place_kinds.kind_id IS 'Stable numeric id referenced by saved_places.kind_id.';
COMMENT ON COLUMN places.place_kinds.code IS 'Machine name used in the API (home, work, study, other).';
COMMENT ON COLUMN places.place_kinds.label IS 'Human-readable name.';

COMMENT ON COLUMN places.geocode_cache.geocode_id IS 'Surrogate key.';
COMMENT ON COLUMN places.geocode_cache.city_code IS 'City the search was limited to.';
COMMENT ON COLUMN places.geocode_cache.query_norm IS 'Search text lower-cased and trimmed; cache key together with city_code.';
COMMENT ON COLUMN places.geocode_cache.display_name IS 'Address label returned by the geocoder.';
COMMENT ON COLUMN places.geocode_cache.geom IS 'Position of the best candidate (WGS 84).';
COMMENT ON COLUMN places.geocode_cache.provider IS 'Geocoder that produced the answer.';
COMMENT ON COLUMN places.geocode_cache.fetched_at IS 'When the geocoder was asked.';
COMMENT ON COLUMN places.geocode_cache.expires_at IS 'After this moment the entry is refreshed or purged.';

COMMENT ON COLUMN places.saved_places.place_id IS 'Id exposed in the API.';
COMMENT ON COLUMN places.saved_places.kind_id IS 'Kind of place (home, work, ...).';
COMMENT ON COLUMN places.saved_places.label IS 'PII. Name the user gave the place; unique per user.';
COMMENT ON COLUMN places.saved_places.address_text IS 'PII. Address as shown to the user.';
COMMENT ON COLUMN places.saved_places.city_code IS 'City of the place (waw, vno).';
COMMENT ON COLUMN places.saved_places.geom IS 'PII. Position (WGS 84); rounded to about 1 km in v_saved_places_masked.';
COMMENT ON COLUMN places.saved_places.created_at IS 'When the place was saved.';
COMMENT ON COLUMN places.saved_places.updated_at IS 'Last change of the row; maintained by trigger saved_places_set_updated_at.';

COMMENT ON COLUMN places.search_history.history_id IS 'Surrogate key; also the tie-breaker when trimming to 50 rows.';
COMMENT ON COLUMN places.search_history.user_id IS 'PII. Logical reference to identity.users; rows are removed on identity.user.deleted.v1.';
COMMENT ON COLUMN places.search_history.calculation_id IS 'Logical reference to accessibility.calculations; opens the same map again while it is cached.';
COMMENT ON COLUMN places.search_history.city_code IS 'City of the calculation.';
COMMENT ON COLUMN places.search_history.origin_h3 IS 'PII. Origin cell of the calculation (H3 resolution 10).';
COMMENT ON COLUMN places.search_history.created_at IS 'When the calculation completed.';

COMMENT ON TABLE  places.processed_messages IS 'Inbox for idempotent consumers: a message id is handled at most once.';
COMMENT ON COLUMN places.processed_messages.message_id IS 'Envelope id of a consumed message.';
COMMENT ON COLUMN places.processed_messages.event_type IS 'Routing key of the consumed message.';
COMMENT ON COLUMN places.processed_messages.processed_at IS 'When the effect was committed.';

-- routines
COMMENT ON FUNCTION places.tg_saved_places_limit() IS 'Trigger: rejects the 21st saved place of a user (advisory lock per user against races).';
COMMENT ON FUNCTION places.tg_search_history_trim() IS 'Trigger: keeps only the latest 50 history rows of a user.';
COMMENT ON FUNCTION places.tg_set_updated_at() IS 'Trigger: sets updated_at to now() on every update.';

-- Down Migration
COMMENT ON FUNCTION places.tg_set_updated_at() IS NULL;
COMMENT ON FUNCTION places.tg_search_history_trim() IS NULL;
COMMENT ON FUNCTION places.tg_saved_places_limit() IS NULL;
COMMENT ON COLUMN places.processed_messages.processed_at IS NULL;
COMMENT ON COLUMN places.processed_messages.event_type IS NULL;
COMMENT ON COLUMN places.processed_messages.message_id IS NULL;
COMMENT ON TABLE  places.processed_messages IS NULL;
COMMENT ON COLUMN places.search_history.created_at IS NULL;
COMMENT ON COLUMN places.search_history.origin_h3 IS NULL;
COMMENT ON COLUMN places.search_history.city_code IS NULL;
COMMENT ON COLUMN places.search_history.calculation_id IS NULL;
COMMENT ON COLUMN places.search_history.user_id IS NULL;
COMMENT ON COLUMN places.search_history.history_id IS NULL;
COMMENT ON COLUMN places.saved_places.updated_at IS NULL;
COMMENT ON COLUMN places.saved_places.created_at IS NULL;
COMMENT ON COLUMN places.saved_places.geom IS NULL;
COMMENT ON COLUMN places.saved_places.city_code IS NULL;
COMMENT ON COLUMN places.saved_places.address_text IS NULL;
COMMENT ON COLUMN places.saved_places.label IS NULL;
COMMENT ON COLUMN places.saved_places.kind_id IS NULL;
COMMENT ON COLUMN places.saved_places.place_id IS NULL;
COMMENT ON COLUMN places.geocode_cache.expires_at IS NULL;
COMMENT ON COLUMN places.geocode_cache.fetched_at IS NULL;
COMMENT ON COLUMN places.geocode_cache.provider IS NULL;
COMMENT ON COLUMN places.geocode_cache.geom IS NULL;
COMMENT ON COLUMN places.geocode_cache.display_name IS NULL;
COMMENT ON COLUMN places.geocode_cache.query_norm IS NULL;
COMMENT ON COLUMN places.geocode_cache.city_code IS NULL;
COMMENT ON COLUMN places.geocode_cache.geocode_id IS NULL;
COMMENT ON COLUMN places.place_kinds.label IS NULL;
COMMENT ON COLUMN places.place_kinds.code IS NULL;
COMMENT ON COLUMN places.place_kinds.kind_id IS NULL;
COMMENT ON COLUMN places.pgmigrations.run_on IS NULL;
COMMENT ON COLUMN places.pgmigrations.name IS NULL;
COMMENT ON COLUMN places.pgmigrations.id IS NULL;
COMMENT ON TABLE  places.pgmigrations IS NULL;
