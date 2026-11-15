-- Query plans of the main queries on realistic volumes. Generates docs/db/query-plans.md:
--   pnpm db:plans
-- Runs as the superuser on a migrated database with reference data. Everything happens in
-- one transaction that is rolled back: volume data is generated, analysed, the plans are
-- captured with EXPLAIN (ANALYZE, BUFFERS), then nothing is left behind.
\set ON_ERROR_STOP on
\pset footer off
BEGIN;
SELECT setseed(0.42) \g /dev/null
-- Bulk generation skips triggers and FK checks (data is generated consistent).
SET LOCAL session_replication_role = replica;

-- identity: 100 000 accounts
INSERT INTO identity.users (email, password_hash, display_name)
SELECT 'user' || g || '@example.com', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA', 'User ' || g
FROM generate_series(1, 100000) g;

-- transit: three feed versions of one source (two archived, one validated), each with
-- 6 000 stops, 300 routes, 20 000 trips and 400 000 stop_times; a 5 000-cell grid.
CREATE TEMP TABLE vol_fv AS
WITH ins AS (
  INSERT INTO transit.feed_versions (feed_source_id, sha256, storage_key, status, valid_from, valid_to)
  SELECT 1, sha256(('volume ' || g)::bytea), 'volume/' || g, CASE WHEN g < 3 THEN 'archived' ELSE 'validated' END,
         date '2026-11-01', date '2027-02-28'
  FROM generate_series(1, 3) g
  RETURNING feed_version_id
) SELECT feed_version_id AS fv FROM ins;

INSERT INTO transit.agencies (feed_version_id, agency_id, gtfs_id, name) SELECT fv, 1, 'A', 'Volume' FROM vol_fv;
INSERT INTO transit.routes (feed_version_id, route_id, agency_id, gtfs_id, short_name, route_type_id)
SELECT fv, r, 1, 'R' || r, r::text, 3 FROM vol_fv, generate_series(1, 300) r;
INSERT INTO transit.stops (feed_version_id, stop_id, gtfs_id, name, geom)
SELECT fv, s, 'S' || s, 'Stop ' || s,
       ST_SetSRID(ST_MakePoint(20.85 + random() * 0.43, 52.10 + random() * 0.27), 4326)::geography
FROM vol_fv, generate_series(1, 6000) s;
INSERT INTO transit.services (feed_version_id, service_id, gtfs_id)
SELECT fv, s, (ARRAY['WK', 'SA', 'SU'])[s] FROM vol_fv, generate_series(1, 3) s;
INSERT INTO transit.service_dates (feed_version_id, service_id, service_date)
SELECT fv, CASE extract(isodow FROM d) WHEN 6 THEN 2 WHEN 7 THEN 3 ELSE 1 END, d::date
FROM vol_fv, generate_series(date '2026-11-01', date '2027-02-28', interval '1 day') d;
INSERT INTO transit.trips (feed_version_id, trip_id, route_id, service_id, gtfs_id)
SELECT fv, t, 1 + t % 300, CASE WHEN t % 10 < 6 THEN 1 WHEN t % 10 < 8 THEN 2 ELSE 3 END, 'T' || t
FROM vol_fv, generate_series(1, 20000) t;
-- Bulk-load technique: build the secondary index after the load (rolled back with the rest).
DROP INDEX transit.stop_times_stop_idx;
INSERT INTO transit.stop_times (feed_version_id, trip_id, stop_sequence, stop_id, arrival_s, departure_s)
SELECT fv, t, k, 1 + ((t % 300) * 20 + k) % 6000, 18000 + (t / 300) * 600 + k * 90, 18000 + (t / 300) * 600 + k * 90 + 15
FROM vol_fv, generate_series(1, 20000) t, generate_series(0, 19) k;
CREATE INDEX stop_times_stop_idx ON transit.stop_times (feed_version_id, stop_id, departure_s);
INSERT INTO transit.hex_cells (h3_index, city_id, centroid)
SELECT '89' || lpad(to_hex(g), 13, '0'), 1,
       ST_SetSRID(ST_MakePoint(20.85 + random() * 0.43, 52.10 + random() * 0.27), 4326)::geography
FROM generate_series(1, 5000) g;

-- accessibility: 200 000 calculations over the three snapshots, 300 000 sent events + 20 pending
INSERT INTO accessibility.feed_snapshots (feed_version_id, city_code, valid_from, valid_to)
SELECT fv, 'waw', date '2026-11-01', date '2027-02-28' FROM vol_fv;
INSERT INTO accessibility.calculations
  (feed_version_id, origin_h3, service_date, departure_s, window_s, algo_version, status,
   created_at, completed_at, expires_at)
SELECT (SELECT min(fv) FROM vol_fv) + g % 3, '8a' || lpad(to_hex(g), 13, '0'), date '2026-12-02', 28800, 0, 1, 'done',
       now() - (g % 1440) * interval '1 minute', now() - (g % 1440) * interval '1 minute' + interval '2 seconds',
       now() + interval '1 day' - (g % 1440) * interval '1 minute'
FROM generate_series(1, 200000) g;
INSERT INTO accessibility.outbox (event_type, payload, occurred_at, published_at)
SELECT 'accessibility.calculation.completed.v1', jsonb_build_object('n', g),
       now() - g * interval '1 second', CASE WHEN g > 20 THEN now() - g * interval '1 second' + interval '50 milliseconds' END
FROM generate_series(1, 300020) g;

-- places: 10 000 users with 30 history rows each
INSERT INTO places.search_history (user_id, calculation_id, city_code, origin_h3, created_at)
SELECT md5('user' || u)::uuid, gen_random_uuid(), 'waw', '8a1f53c9a437fff', now() - h * interval '1 hour'
FROM generate_series(1, 10000) u, generate_series(1, 30) h;

SET LOCAL session_replication_role = origin;
ANALYZE identity.users, transit.feed_versions, transit.stops, transit.trips, transit.stop_times,
        transit.service_dates, transit.hex_cells, accessibility.calculations, accessibility.outbox,
        places.search_history;

SELECT max(fv) AS fv FROM vol_fv \gset
SELECT h3_index AS cell FROM transit.hex_cells WHERE h3_index LIKE '89%' ORDER BY h3_index OFFSET 2500 LIMIT 1 \gset
SELECT feed_version_id AS calc_fv, origin_h3 AS calc_origin FROM accessibility.calculations ORDER BY calculation_id LIMIT 1 \gset

\echo '# Query plans'
\echo ''
\echo 'Generated by `pnpm db:plans` (`db/tests/query-plans.sql`). The script fills a scratch transaction'
\echo 'with volume data, runs `ANALYZE`, captures `EXPLAIN (ANALYZE, BUFFERS)` and rolls back.'
\echo 'Timings depend on the machine; the plan shapes are what matters.'
\echo ''
\echo '| Table | Rows in the run |'
\echo '| --- | --- |'
SELECT format('| `%s` | %s |', t, to_char(n, 'FM999,999,999')) FROM (VALUES
  ('identity.users', (SELECT count(*) FROM identity.users)),
  ('transit.stops', (SELECT count(*) FROM transit.stops)),
  ('transit.trips', (SELECT count(*) FROM transit.trips)),
  ('transit.stop_times', (SELECT count(*) FROM transit.stop_times)),
  ('transit.hex_cells', (SELECT count(*) FROM transit.hex_cells)),
  ('accessibility.calculations', (SELECT count(*) FROM accessibility.calculations)),
  ('accessibility.outbox', (SELECT count(*) FROM accessibility.outbox)),
  ('places.search_history', (SELECT count(*) FROM places.search_history))) v(t, n) \g (tuples_only format=unaligned)

\echo ''
\echo '## 1. Sign-in by email (identity)'
\echo ''
\echo 'Served by `users_email_uq` (unique, `citext`, so the lookup is case-insensitive).'
\echo ''
\echo '```sql'
\echo 'SELECT user_id, password_hash, role_id FROM identity.users WHERE email = $1 AND deleted_at IS NULL;'
\echo '```'
\echo ''
\echo '```text'
EXPLAIN (ANALYZE, BUFFERS)
SELECT user_id, password_hash, role_id FROM identity.users WHERE email = 'User77777@Example.com' AND deleted_at IS NULL
\g (tuples_only format=unaligned)
\echo '```'

\echo ''
\echo '## 2. Nearest stops of a cell (transit-data, `rebuild_hex_stop_access`)'
\echo ''
\echo 'K-nearest-neighbour search on `stops_geom_gix` (GiST, `<->` ordering) limited by `ST_DWithin`.'
\echo ''
\echo '```sql'
\echo 'SELECT n.stop_id, n.dist_m FROM transit.hex_cells h'
\echo 'CROSS JOIN LATERAL (SELECT s.stop_id, ST_Distance(s.geom, h.centroid) AS dist_m FROM transit.stops s'
\echo '  WHERE s.feed_version_id = $1 AND ST_DWithin(s.geom, h.centroid, 1500)'
\echo '  ORDER BY s.geom <-> h.centroid LIMIT 5) n'
\echo 'WHERE h.h3_index = $2;'
\echo '```'
\echo ''
\echo '```text'
EXPLAIN (ANALYZE, BUFFERS)
SELECT n.stop_id, n.dist_m FROM transit.hex_cells h
CROSS JOIN LATERAL (SELECT s.stop_id, ST_Distance(s.geom, h.centroid) AS dist_m FROM transit.stops s
  WHERE s.feed_version_id = :fv AND ST_DWithin(s.geom, h.centroid, 1500)
  ORDER BY s.geom <-> h.centroid LIMIT 5) n
WHERE h.h3_index = :'cell'
\g (tuples_only format=unaligned)
\echo '```'

\echo ''
\echo '## 3. Timetable export for one date (transit-data internal API)'
\echo ''
\echo 'Services of the date from `service_dates_date_idx`, their trips through `trips_service_idx`,'
\echo 'stop times by the primary key `(feed_version_id, trip_id, stop_sequence)`.'
\echo ''
\echo '```sql'
\echo 'SELECT t.route_id, t.trip_id, st.stop_sequence, st.stop_id, st.arrival_s, st.departure_s'
\echo 'FROM transit.service_dates sd'
\echo 'JOIN transit.trips t ON t.feed_version_id = sd.feed_version_id AND t.service_id = sd.service_id'
\echo 'JOIN transit.stop_times st ON st.feed_version_id = t.feed_version_id AND st.trip_id = t.trip_id'
\echo 'WHERE sd.feed_version_id = $1 AND sd.service_date = $2'
\echo 'ORDER BY t.route_id, t.trip_id, st.stop_sequence;'
\echo '```'
\echo ''
\echo '```text'
EXPLAIN (ANALYZE, BUFFERS)
SELECT t.route_id, t.trip_id, st.stop_sequence, st.stop_id, st.arrival_s, st.departure_s
FROM transit.service_dates sd
JOIN transit.trips t ON t.feed_version_id = sd.feed_version_id AND t.service_id = sd.service_id
JOIN transit.stop_times st ON st.feed_version_id = t.feed_version_id AND st.trip_id = t.trip_id
WHERE sd.feed_version_id = :fv AND sd.service_date = date '2026-12-02'
ORDER BY t.route_id, t.trip_id, st.stop_sequence
\g (tuples_only format=unaligned)
\echo '```'
\echo ''
\echo '**Sequential scan on `stop_times`: reviewed, no index added.** One weekday selects 60 % of the'
\echo 'trips of a feed, so the query needs 240 000 of the 400 000 stop times of that feed. They are spread'
\echo 'over every page of the feed, so an index path reads the same pages in key order with more'
\echo 'overhead; 3b forces it for comparison. The export runs once per (feed version, date) and is'
\echo 'cached on disk (`docs/05-algorithms.md#4-timetable-artifact-transit-data---accessibility`), and the'
\echo 'scan grows with the number of stored feed versions, so archived versions should be deleted'
\echo '(`ON DELETE CASCADE` from `feed_versions`) rather than kept. The sort spills to disk with the'
\echo 'default `work_mem` of 4 MB; the export transaction sets `SET LOCAL work_mem = ''64MB''`.'
\echo ''
\echo '### 3b. The same query with sequential scans disabled (comparison only)'
\echo ''
\echo '```text'
SET LOCAL enable_seqscan = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT t.route_id, t.trip_id, st.stop_sequence, st.stop_id, st.arrival_s, st.departure_s
FROM transit.service_dates sd
JOIN transit.trips t ON t.feed_version_id = sd.feed_version_id AND t.service_id = sd.service_id
JOIN transit.stop_times st ON st.feed_version_id = t.feed_version_id AND st.trip_id = t.trip_id
WHERE sd.feed_version_id = :fv AND sd.service_date = date '2026-12-02'
ORDER BY t.route_id, t.trip_id, st.stop_sequence
\g (tuples_only format=unaligned)
RESET enable_seqscan;
\echo '```'

\echo ''
\echo '## 4. Calculation cache lookup (accessibility)'
\echo ''
\echo 'Exact match on the partial unique index `calculations_cache_uq` (same index guards single flight).'
\echo ''
\echo '```sql'
\echo 'SELECT calculation_id, status FROM accessibility.calculations'
\echo 'WHERE feed_version_id = $1 AND origin_h3 = $2 AND service_date = $3 AND departure_s = $4'
\echo '  AND window_s = $5 AND algo_version = $6 AND status IN (''running'', ''done'');'
\echo '```'
\echo ''
\echo '```text'
EXPLAIN (ANALYZE, BUFFERS)
SELECT calculation_id, status FROM accessibility.calculations
WHERE feed_version_id = :calc_fv AND origin_h3 = :'calc_origin' AND service_date = date '2026-12-02'
  AND departure_s = 28800 AND window_s = 0 AND algo_version = 1 AND status IN ('running', 'done')
\g (tuples_only format=unaligned)
\echo '```'

\echo ''
\echo '## 5. History page (places)'
\echo ''
\echo '`search_history_user_idx (user_id, created_at DESC)` returns the rows already in page order.'
\echo ''
\echo '```sql'
\echo 'SELECT calculation_id, city_code, origin_h3, created_at FROM places.search_history'
\echo 'WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20;'
\echo '```'
\echo ''
\echo '```text'
EXPLAIN (ANALYZE, BUFFERS)
SELECT calculation_id, city_code, origin_h3, created_at FROM places.search_history
WHERE user_id = md5('user4242')::uuid ORDER BY created_at DESC LIMIT 20
\g (tuples_only format=unaligned)
\echo '```'

\echo ''
\echo '## 6. Outbox poll (every service with an outbox)'
\echo ''
\echo 'The partial index `outbox_unpublished_idx` holds only pending rows, so the poll stays cheap'
\echo 'however many events were already sent. `SKIP LOCKED` lets several publishers run.'
\echo ''
\echo '```sql'
\echo 'SELECT event_id, event_type, payload, occurred_at FROM accessibility.outbox'
\echo 'WHERE published_at IS NULL ORDER BY occurred_at LIMIT 100 FOR UPDATE SKIP LOCKED;'
\echo '```'
\echo ''
\echo '```text'
EXPLAIN (ANALYZE, BUFFERS)
SELECT event_id, event_type, payload, occurred_at FROM accessibility.outbox
WHERE published_at IS NULL ORDER BY occurred_at LIMIT 100 FOR UPDATE SKIP LOCKED
\g (tuples_only format=unaligned)
\echo '```'

ROLLBACK;
