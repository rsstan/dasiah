-- End-to-end database smoke test. Run as a superuser on a scratch database
-- after bootstrap + migrations + reference seeds:
--   psql -U postgres -d heatmap -v ON_ERROR_STOP=1 -f db/tests/smoke.sql
-- Everything runs in one transaction and is rolled back.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.must_fail(p_sql text, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ok (rejected): % [%]', p_what, SQLSTATE;
    RETURN;
  END;
  RAISE EXCEPTION 'NOT rejected: %', p_what;
END $$;

-- ================================================= transit: staging -> core -> active
SET ROLE svc_transit;
INSERT INTO transit.feed_versions (feed_source_id, sha256, storage_key)
VALUES (1, sha256('smoke'), 'raw/smoke.zip');
SELECT feed_version_id AS fv FROM transit.feed_versions WHERE storage_key = 'raw/smoke.zip' \gset

INSERT INTO transit_staging.agency VALUES (:fv, 'A', 'Test Transit', 'Europe/Warsaw');
INSERT INTO transit_staging.routes VALUES (:fv, 'R1', 'A', '1', 'Line one', '3'), (:fv, 'R2', '', 'M', NULL, '1');
INSERT INTO transit_staging.stops VALUES
  (:fv, 'S1', 'Alpha',   '52.2300', '21.0000', ''),
  (:fv, 'S2', 'Beta',    '52.2400', '21.0100', '0'),
  (:fv, 'S3', 'Gamma',   '52.2500', '21.0200', NULL),
  (:fv, 'S3b', 'Gamma 2', '52.2501', '21.0203', ''),
  (:fv, 'ST', 'Station (not a boarding point)', '52.2500', '21.0200', '1');
INSERT INTO transit_staging.calendar VALUES (:fv, 'WD', '1','1','1','1','1','0','0', '20260105', '20260118');
INSERT INTO transit_staging.calendar_dates VALUES (:fv, 'WD', '20260106', '2'), (:fv, 'HOL', '20260106', '1');
INSERT INTO transit_staging.trips VALUES (:fv, 'T1', 'R1', 'WD', 'Gamma', '0'), (:fv, 'T2', 'R2', 'HOL', '', '');
INSERT INTO transit_staging.stop_times VALUES
  (:fv, 'T1', '1', 'S1', '08:00:00', '08:00:00'),
  (:fv, 'T1', '2', 'S2', '08:05:00', '08:06:00'),
  (:fv, 'T1', '3', 'S3', '08:12:00', '08:12:00'),
  (:fv, 'T2', '1', 'S3b', '23:55:00', '23:55:00'),
  (:fv, 'T2', '2', 'S1', '24:10:00', '');           -- past midnight, empty departure

SELECT pg_temp.must_fail(format('CALL transit.promote_feed(%s)', :fv), 'promote before status staged');
UPDATE transit.feed_versions SET status = 'staged' WHERE feed_version_id = :fv;
CALL transit.promote_feed(:fv);

DO $$
DECLARE fv int := (SELECT feed_version_id FROM transit.feed_versions WHERE storage_key = 'raw/smoke.zip');
BEGIN
  ASSERT (SELECT status FROM transit.feed_versions WHERE feed_version_id = fv) = 'validated';
  ASSERT (SELECT count(*) FROM transit.stops WHERE feed_version_id = fv) = 4, 'stations are skipped';
  ASSERT (SELECT count(*) FROM transit.stop_times WHERE feed_version_id = fv) = 5;
  ASSERT (SELECT max(arrival_s) FROM transit.stop_times WHERE feed_version_id = fv) = 87000, '24:10:00';
  -- 10 weekdays in range, minus the removed 6 Jan, plus HOL on 6 Jan
  ASSERT (SELECT count(*) FROM transit.service_dates WHERE feed_version_id = fv) = 10;
  ASSERT (SELECT valid_from FROM transit.feed_versions WHERE feed_version_id = fv) = DATE '2026-01-05';
  ASSERT (SELECT count(*) FROM transit_staging.stop_times WHERE feed_version_id = fv) = 0, 'staging cleaned';
END $$;

CALL transit.rebuild_transfers(:fv);
INSERT INTO transit.hex_cells (h3_index, city_id, centroid) VALUES
  ('891f53c9a43ffff', 1, ST_SetSRID(ST_MakePoint(21.0005, 52.2302), 4326)::geography),  -- next to S1
  ('891f53c9a47ffff', 1, ST_SetSRID(ST_MakePoint(21.2000, 52.3500), 4326)::geography);  -- far from any stop
SELECT pg_temp.must_fail(format('CALL transit.activate_feed(%s)', :fv), 'activate without hex_stop_access');
CALL transit.rebuild_hex_stop_access(:fv);
CALL transit.activate_feed(:fv);

DO $$
DECLARE fv int := (SELECT feed_version_id FROM transit.feed_versions WHERE storage_key = 'raw/smoke.zip');
BEGIN
  ASSERT (SELECT count(*) FROM transit.transfers WHERE feed_version_id = fv) = 2, 'S3 <-> S3b';
  ASSERT (SELECT count(DISTINCT h3_index) FROM transit.hex_stop_access WHERE feed_version_id = fv) = 1;
  ASSERT (SELECT count(*) FROM transit.v_active_feeds WHERE feed_version_id = fv) = 1;
  ASSERT (SELECT hex_with_stop FROM transit.mv_city_coverage WHERE feed_version_id = fv) = 1;
  ASSERT (SELECT count(*) FROM transit.outbox WHERE event_type = 'transit.feed.activated.v1') = 1;
END $$;
SELECT pg_temp.must_fail(format($q$UPDATE transit.feed_versions SET status = 'staged' WHERE feed_version_id = %s$q$, :fv),
                         'illegal status change active -> staged');
SELECT pg_temp.must_fail($q$INSERT INTO transit.stop_times VALUES (1, 1, 1, 1, 100, 50)$q$, 'departure before arrival');
SELECT pg_temp.must_fail('SELECT 1 FROM identity.users', 'svc_transit reads identity');
RESET ROLE;

-- ================================================= identity
SET ROLE svc_identity;
INSERT INTO identity.users (email, password_hash, display_name)
VALUES ('Jan.Kowalski@Example.com', '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA', 'Jan Kowalski');
SELECT user_id AS uid FROM identity.users WHERE email = 'jan.kowalski@example.com' \gset
SELECT pg_temp.must_fail($q$INSERT INTO identity.users (email, password_hash) VALUES ('JAN.KOWALSKI@example.com', '$argon2id$x')$q$, 'duplicate email, different case');
SELECT pg_temp.must_fail($q$INSERT INTO identity.users (email, password_hash) VALUES ('a@b.co', '5f4dcc3b5aa765d61d8327deb882cf99')$q$, 'non-argon2id hash');
SELECT pg_temp.must_fail($q$INSERT INTO identity.users (email, password_hash) VALUES ('not-an-email', '$argon2id$x')$q$, 'bad email');
INSERT INTO identity.refresh_tokens (user_id, token_hash, expires_at, ip) VALUES (:'uid', sha256('t'), now() + interval '30 days', '203.0.113.77');
INSERT INTO identity.audit_log (user_id, event_type_id, ip) VALUES (:'uid', 2, '203.0.113.77');
UPDATE identity.users SET display_name = 'Jan K.' WHERE user_id = :'uid';
SELECT pg_temp.must_fail('DELETE FROM identity.audit_log', 'audit log is append-only');
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM identity.audit_log a JOIN identity.audit_event_types t USING (event_type_id)
          WHERE t.code IN ('user_registered', 'profile_updated')) = 2, 'audit trigger';
  ASSERT (SELECT email_masked FROM identity.v_users_masked) = 'J***@Example.com';
  ASSERT (SELECT ip_masked FROM identity.v_audit_masked WHERE ip_masked IS NOT NULL LIMIT 1) = '203.0.113.0/24';
END $$;
CALL identity.anonymize_user(:'uid');
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM identity.users WHERE email::text LIKE '%example.com' OR display_name IS NOT NULL) = 0;
  ASSERT (SELECT count(*) FROM identity.refresh_tokens) = 0;
  ASSERT (SELECT count(*) FROM identity.audit_log WHERE ip IS NOT NULL) = 0;
  ASSERT (SELECT count(*) FROM identity.outbox WHERE event_type = 'identity.user.deleted.v1') = 1;
END $$;
RESET ROLE;

SET ROLE reporting;
SELECT pg_temp.must_fail('SELECT 1 FROM identity.users', 'reporting reads raw users');
SELECT pg_temp.must_fail('SELECT 1 FROM places.saved_places', 'reporting reads raw saved places');
SELECT pg_temp.must_fail($q$INSERT INTO transit.route_types VALUES (99, 'x', 'x')$q$, 'reporting writes');
-- Read every column of the masked views: masking functions run with the caller's rights.
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM identity.v_users_masked
          WHERE email_masked LIKE '_***@%' AND (display_name_masked IS NULL OR display_name_masked LIKE '_***')) >= 1,
         'reporting reads masked users';
  ASSERT (SELECT count(*) FROM (SELECT audit_id, user_id, event_code, occurred_at, ip_masked FROM identity.v_audit_masked) a) >= 1,
         'reporting reads masked audit log';
END $$;
SELECT count(*) AS stops_visible FROM transit.stops;
RESET ROLE;

-- ================================================= accessibility
SET ROLE svc_accessibility;
INSERT INTO accessibility.feed_snapshots (feed_version_id, city_code, valid_from, valid_to, is_current)
VALUES (101, 'waw', '2026-01-05', '2026-01-18', true), (102, 'waw', '2026-01-12', '2026-01-25', true);
INSERT INTO accessibility.calculations (feed_version_id, origin_h3, service_date, departure_s, algo_version, expires_at)
VALUES (102, '8a1f53c9a437fff', '2026-01-13', 28800, 1, now() + interval '1 day');
SELECT calculation_id AS cid FROM accessibility.calculations \gset
SELECT pg_temp.must_fail($q$INSERT INTO accessibility.calculations (feed_version_id, origin_h3, service_date, departure_s, algo_version, expires_at)
  VALUES (102, '8a1f53c9a437fff', '2026-01-13', 28800, 1, now() + interval '1 day')$q$, 'same calculation twice (single-flight)');
INSERT INTO accessibility.calculation_results (calculation_id, h3_index, transit_s, car_s, has_stop) VALUES
  (:'cid', '891f53c9a43ffff', 1100, 1000, true),   -- 1.10 excellent
  (:'cid', '891f53c9a47ffff', 1200, 1000, true),   -- 1.20 good (boundary belongs to the upper class)
  (:'cid', '891f53c9a4bffff', 9000, 1000, true),   -- 9.00 very_poor
  (:'cid', '891f53c9a4fffff', NULL, 1000, true),   -- unreachable
  (:'cid', '891f53c9a53ffff', NULL, 1000, false);  -- no_transit
SELECT pg_temp.must_fail(format($q$INSERT INTO accessibility.calculation_results VALUES (%L, '891f53c9a57ffff', 10, 10, false)$q$, :'cid'), 'transit time without a stop');
UPDATE accessibility.calculations SET status = 'done' WHERE calculation_id = :'cid';
SELECT pg_temp.must_fail(format($q$UPDATE accessibility.calculations SET status = 'failed', error_code = 'x' WHERE calculation_id = %L$q$, :'cid'), 'finished calculation changes status');
SELECT pg_temp.must_fail($q$INSERT INTO accessibility.ratio_classes VALUES (9, 'dup', 'x', 1.50, 1.70, '#000000', 9)$q$, 'overlapping legend ranges');
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM accessibility.feed_snapshots WHERE is_current) = 1;
  ASSERT (SELECT string_agg(class_code, ',' ORDER BY h3_index) FROM accessibility.v_calculation_results)
         = 'excellent,good,very_poor,unreachable,no_transit';
  ASSERT (SELECT completed_at IS NOT NULL FROM accessibility.calculations);
  ASSERT (SELECT calculations FROM accessibility.v_daily_usage) = 1;
  UPDATE accessibility.calculations SET created_at = now() - interval '3 days', expires_at = now() - interval '1 day';
  ASSERT accessibility.purge_expired() = 1;
  ASSERT (SELECT count(*) FROM accessibility.calculation_results) = 0, 'cascade';
END $$;
RESET ROLE;

-- ================================================= places
SET ROLE svc_places;
INSERT INTO places.saved_places (user_id, kind_id, label, address_text, city_code, geom)
SELECT '00000000-0000-0000-0000-000000000001', 1, 'place ' || g, 'Marszalkowska ' || g, 'waw',
       ST_SetSRID(ST_MakePoint(21.01234, 52.23456), 4326)::geography
FROM generate_series(1, 20) g;
SELECT pg_temp.must_fail($q$INSERT INTO places.saved_places (user_id, kind_id, label, address_text, city_code, geom)
  VALUES ('00000000-0000-0000-0000-000000000001', 1, 'place 21', 'Marszalkowska 21', 'waw', ST_SetSRID(ST_MakePoint(21, 52), 4326)::geography)$q$, '21st saved place');
INSERT INTO places.search_history (user_id, calculation_id, city_code, origin_h3, created_at)
SELECT '00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'waw', '8a1f53c9a437fff', now() + g * interval '1 second'
FROM generate_series(1, 55) g;
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM places.search_history) = 50, 'history trimmed to 50';
  ASSERT (SELECT lat_approx FROM places.v_saved_places_masked LIMIT 1) = 52.23;
  ASSERT places.erase_user('00000000-0000-0000-0000-000000000001') = 70;
END $$;
RESET ROLE;

ROLLBACK;
\echo SMOKE TEST PASSED
