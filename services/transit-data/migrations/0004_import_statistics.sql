-- Up Migration
-- Fresh planner statistics during and right after an import.
--
-- Found on the real Vilnius feed: without them the planner works with stale numbers. After old
-- feed versions are deleted, autovacuum records the core tables as nearly empty while their
-- files stay large, so rows inserted inside promote_feed are estimated at a few dozen and the
-- 400 000 staged stop_times are joined with nested loops (the promotion ran over 10 minutes and
-- was cancelled; 127 s before). Likewise a timetable export right after an import took over
-- 300 s until autovacuum analysed the tables, then 0.5 s.
--
-- Only the owner may ANALYZE in PostgreSQL 16, hence a SECURITY DEFINER function. ANALYZE inside
-- the import transaction sees that transaction's own inserted rows.
CREATE FUNCTION transit.analyze_feed_tables() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = transit, public, pg_temp AS $$
BEGIN
  ANALYZE transit_staging.agency, transit_staging.routes, transit_staging.stops, transit_staging.trips,
          transit_staging.stop_times, transit_staging.calendar, transit_staging.calendar_dates;
  ANALYZE transit.agencies, transit.routes, transit.stops, transit.services, transit.service_dates,
          transit.trips, transit.stop_times, transit.transfers, transit.hex_stop_access;
END $$;
COMMENT ON FUNCTION transit.analyze_feed_tables() IS 'Refreshes planner statistics of the staging, core GTFS and mart tables; used by promote_feed and the import.';

-- promote_feed of 0001 with two statistics refreshes added; otherwise unchanged.
CREATE OR REPLACE PROCEDURE transit.promote_feed(p_fv integer)
LANGUAGE plpgsql AS $$
DECLARE v_orphans bigint;
BEGIN
  PERFORM 1 FROM transit.feed_versions WHERE feed_version_id = p_fv AND status = 'staged' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'feed version % is not in status staged', p_fv;
  END IF;

  -- Statistics of the freshly COPYed staging rows (and of the core tables before they grow).
  PERFORM transit.analyze_feed_tables();

  INSERT INTO transit.agencies (feed_version_id, agency_id, gtfs_id, name)
  SELECT p_fv, row_number() OVER (ORDER BY agency_id), coalesce(nullif(btrim(agency_id), ''), 'default'), btrim(agency_name)
  FROM transit_staging.agency WHERE feed_version_id = p_fv;

  INSERT INTO transit.routes (feed_version_id, route_id, agency_id, gtfs_id, short_name, long_name, route_type_id)
  SELECT p_fv, row_number() OVER (ORDER BY r.route_id), a.agency_id, r.route_id,
         nullif(btrim(r.route_short_name), ''), nullif(btrim(r.route_long_name), ''), r.route_type::smallint
  FROM transit_staging.routes r
  JOIN transit.agencies a
    ON a.feed_version_id = p_fv
   AND (a.gtfs_id = btrim(r.agency_id)
        OR (nullif(btrim(r.agency_id), '') IS NULL
            AND (SELECT count(*) FROM transit.agencies WHERE feed_version_id = p_fv) = 1))
  WHERE r.feed_version_id = p_fv;

  -- only boarding locations (location_type empty or 0)
  INSERT INTO transit.stops (feed_version_id, stop_id, gtfs_id, name, geom)
  SELECT p_fv, row_number() OVER (ORDER BY stop_id), stop_id, btrim(stop_name),
         ST_SetSRID(ST_MakePoint(stop_lon::float8, stop_lat::float8), 4326)::geography
  FROM transit_staging.stops
  WHERE feed_version_id = p_fv AND coalesce(nullif(btrim(location_type), ''), '0') = '0';

  INSERT INTO transit.services (feed_version_id, service_id, gtfs_id)
  SELECT p_fv, row_number() OVER (ORDER BY service_id), service_id
  FROM (SELECT service_id FROM transit_staging.calendar WHERE feed_version_id = p_fv
        UNION
        SELECT service_id FROM transit_staging.calendar_dates WHERE feed_version_id = p_fv) s;

  INSERT INTO transit.service_dates (feed_version_id, service_id, service_date)
  SELECT p_fv, s.service_id, d.service_date
  FROM (
    SELECT c.service_id AS gtfs_id, g::date AS service_date
    FROM transit_staging.calendar c
    CROSS JOIN LATERAL generate_series(to_date(c.start_date, 'YYYYMMDD'), to_date(c.end_date, 'YYYYMMDD'), interval '1 day') g
    WHERE c.feed_version_id = p_fv
      AND (ARRAY[c.sunday, c.monday, c.tuesday, c.wednesday, c.thursday, c.friday, c.saturday])[extract(dow FROM g)::int + 1] = '1'
    UNION
    SELECT service_id, to_date(date, 'YYYYMMDD')
    FROM transit_staging.calendar_dates WHERE feed_version_id = p_fv AND exception_type = '1'
    EXCEPT
    SELECT service_id, to_date(date, 'YYYYMMDD')
    FROM transit_staging.calendar_dates WHERE feed_version_id = p_fv AND exception_type = '2'
  ) d
  JOIN transit.services s ON s.feed_version_id = p_fv AND s.gtfs_id = d.gtfs_id;

  INSERT INTO transit.trips (feed_version_id, trip_id, route_id, service_id, gtfs_id, headsign, direction)
  SELECT p_fv, row_number() OVER (ORDER BY t.trip_id), r.route_id, s.service_id, t.trip_id,
         nullif(btrim(t.trip_headsign), ''), nullif(btrim(t.direction_id), '')::smallint
  FROM transit_staging.trips t
  JOIN transit.routes   r ON r.feed_version_id = p_fv AND r.gtfs_id = t.route_id
  JOIN transit.services s ON s.feed_version_id = p_fv AND s.gtfs_id = t.service_id
  WHERE t.feed_version_id = p_fv;

  -- The trips and stops just inserted must be visible to the planner before the largest join.
  PERFORM transit.analyze_feed_tables();

  INSERT INTO transit.stop_times (feed_version_id, trip_id, stop_sequence, stop_id, arrival_s, departure_s)
  SELECT p_fv, t.trip_id, st.stop_sequence::smallint, s.stop_id,
         transit.gtfs_time_to_seconds(coalesce(nullif(btrim(st.arrival_time), ''), st.departure_time)),
         transit.gtfs_time_to_seconds(coalesce(nullif(btrim(st.departure_time), ''), st.arrival_time))
  FROM transit_staging.stop_times st
  JOIN transit.trips t ON t.feed_version_id = p_fv AND t.gtfs_id = st.trip_id
  JOIN transit.stops s ON s.feed_version_id = p_fv AND s.gtfs_id = st.stop_id
  WHERE st.feed_version_id = p_fv;

  -- data quality gates: nothing may be lost silently between staging and core
  SELECT (SELECT count(*) FROM transit_staging.stop_times WHERE feed_version_id = p_fv)
       - (SELECT count(*) FROM transit.stop_times WHERE feed_version_id = p_fv) INTO v_orphans;
  IF v_orphans <> 0 THEN
    RAISE EXCEPTION 'feed version %: % stop_times rows reference unknown trips or stops', p_fv, v_orphans;
  END IF;
  SELECT (SELECT count(*) FROM transit_staging.trips WHERE feed_version_id = p_fv)
       - (SELECT count(*) FROM transit.trips WHERE feed_version_id = p_fv) INTO v_orphans;
  IF v_orphans <> 0 THEN
    RAISE EXCEPTION 'feed version %: % trips reference unknown routes or services', p_fv, v_orphans;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM transit.service_dates WHERE feed_version_id = p_fv) THEN
    RAISE EXCEPTION 'feed version %: no service dates', p_fv;
  END IF;

  UPDATE transit.feed_versions v
     SET status = 'validated',
         valid_from = d.min_date, valid_to = d.max_date
    FROM (SELECT min(service_date) AS min_date, max(service_date) AS max_date
          FROM transit.service_dates WHERE feed_version_id = p_fv) d
   WHERE v.feed_version_id = p_fv;

  DELETE FROM transit_staging.agency         WHERE feed_version_id = p_fv;
  DELETE FROM transit_staging.routes         WHERE feed_version_id = p_fv;
  DELETE FROM transit_staging.stops          WHERE feed_version_id = p_fv;
  DELETE FROM transit_staging.trips          WHERE feed_version_id = p_fv;
  DELETE FROM transit_staging.stop_times     WHERE feed_version_id = p_fv;
  DELETE FROM transit_staging.calendar       WHERE feed_version_id = p_fv;
  DELETE FROM transit_staging.calendar_dates WHERE feed_version_id = p_fv;
END $$;
COMMENT ON PROCEDURE transit.promote_feed(integer) IS 'Staging to core for one feed version: type conversion, key assignment, quality gates. All or nothing.';

-- Down Migration
CREATE OR REPLACE PROCEDURE transit.promote_feed(p_fv integer)
LANGUAGE plpgsql AS $$
DECLARE v_orphans bigint;
BEGIN
  PERFORM 1 FROM transit.feed_versions WHERE feed_version_id = p_fv AND status = 'staged' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'feed version % is not in status staged', p_fv;
  END IF;

  INSERT INTO transit.agencies (feed_version_id, agency_id, gtfs_id, name)
  SELECT p_fv, row_number() OVER (ORDER BY agency_id), coalesce(nullif(btrim(agency_id), ''), 'default'), btrim(agency_name)
  FROM transit_staging.agency WHERE feed_version_id = p_fv;

  INSERT INTO transit.routes (feed_version_id, route_id, agency_id, gtfs_id, short_name, long_name, route_type_id)
  SELECT p_fv, row_number() OVER (ORDER BY r.route_id), a.agency_id, r.route_id,
         nullif(btrim(r.route_short_name), ''), nullif(btrim(r.route_long_name), ''), r.route_type::smallint
  FROM transit_staging.routes r
  JOIN transit.agencies a
    ON a.feed_version_id = p_fv
   AND (a.gtfs_id = btrim(r.agency_id)
        OR (nullif(btrim(r.agency_id), '') IS NULL
            AND (SELECT count(*) FROM transit.agencies WHERE feed_version_id = p_fv) = 1))
  WHERE r.feed_version_id = p_fv;

  -- only boarding locations (location_type empty or 0)
  INSERT INTO transit.stops (feed_version_id, stop_id, gtfs_id, name, geom)
  SELECT p_fv, row_number() OVER (ORDER BY stop_id), stop_id, btrim(stop_name),
         ST_SetSRID(ST_MakePoint(stop_lon::float8, stop_lat::float8), 4326)::geography
  FROM transit_staging.stops
  WHERE feed_version_id = p_fv AND coalesce(nullif(btrim(location_type), ''), '0') = '0';

  INSERT INTO transit.services (feed_version_id, service_id, gtfs_id)
  SELECT p_fv, row_number() OVER (ORDER BY service_id), service_id
  FROM (SELECT service_id FROM transit_staging.calendar WHERE feed_version_id = p_fv
        UNION
        SELECT service_id FROM transit_staging.calendar_dates WHERE feed_version_id = p_fv) s;

  INSERT INTO transit.service_dates (feed_version_id, service_id, service_date)
  SELECT p_fv, s.service_id, d.service_date
  FROM (
    SELECT c.service_id AS gtfs_id, g::date AS service_date
    FROM transit_staging.calendar c
    CROSS JOIN LATERAL generate_series(to_date(c.start_date, 'YYYYMMDD'), to_date(c.end_date, 'YYYYMMDD'), interval '1 day') g
    WHERE c.feed_version_id = p_fv
      AND (ARRAY[c.sunday, c.monday, c.tuesday, c.wednesday, c.thursday, c.friday, c.saturday])[extract(dow FROM g)::int + 1] = '1'
    UNION
    SELECT service_id, to_date(date, 'YYYYMMDD')
    FROM transit_staging.calendar_dates WHERE feed_version_id = p_fv AND exception_type = '1'
    EXCEPT
    SELECT service_id, to_date(date, 'YYYYMMDD')
    FROM transit_staging.calendar_dates WHERE feed_version_id = p_fv AND exception_type = '2'
  ) d
  JOIN transit.services s ON s.feed_version_id = p_fv AND s.gtfs_id = d.gtfs_id;

  INSERT INTO transit.trips (feed_version_id, trip_id, route_id, service_id, gtfs_id, headsign, direction)
  SELECT p_fv, row_number() OVER (ORDER BY t.trip_id), r.route_id, s.service_id, t.trip_id,
         nullif(btrim(t.trip_headsign), ''), nullif(btrim(t.direction_id), '')::smallint
  FROM transit_staging.trips t
  JOIN transit.routes   r ON r.feed_version_id = p_fv AND r.gtfs_id = t.route_id
  JOIN transit.services s ON s.feed_version_id = p_fv AND s.gtfs_id = t.service_id
  WHERE t.feed_version_id = p_fv;

  INSERT INTO transit.stop_times (feed_version_id, trip_id, stop_sequence, stop_id, arrival_s, departure_s)
  SELECT p_fv, t.trip_id, st.stop_sequence::smallint, s.stop_id,
         transit.gtfs_time_to_seconds(coalesce(nullif(btrim(st.arrival_time), ''), st.departure_time)),
         transit.gtfs_time_to_seconds(coalesce(nullif(btrim(st.departure_time), ''), st.arrival_time))
  FROM transit_staging.stop_times st
  JOIN transit.trips t ON t.feed_version_id = p_fv AND t.gtfs_id = st.trip_id
  JOIN transit.stops s ON s.feed_version_id = p_fv AND s.gtfs_id = st.stop_id
  WHERE st.feed_version_id = p_fv;

  -- data quality gates: nothing may be lost silently between staging and core
  SELECT (SELECT count(*) FROM transit_staging.stop_times WHERE feed_version_id = p_fv)
       - (SELECT count(*) FROM transit.stop_times WHERE feed_version_id = p_fv) INTO v_orphans;
  IF v_orphans <> 0 THEN
    RAISE EXCEPTION 'feed version %: % stop_times rows reference unknown trips or stops', p_fv, v_orphans;
  END IF;
  SELECT (SELECT count(*) FROM transit_staging.trips WHERE feed_version_id = p_fv)
       - (SELECT count(*) FROM transit.trips WHERE feed_version_id = p_fv) INTO v_orphans;
  IF v_orphans <> 0 THEN
    RAISE EXCEPTION 'feed version %: % trips reference unknown routes or services', p_fv, v_orphans;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM transit.service_dates WHERE feed_version_id = p_fv) THEN
    RAISE EXCEPTION 'feed version %: no service dates', p_fv;
  END IF;

  UPDATE transit.feed_versions v
     SET status = 'validated',
         valid_from = d.min_date, valid_to = d.max_date
    FROM (SELECT min(service_date) AS min_date, max(service_date) AS max_date
          FROM transit.service_dates WHERE feed_version_id = p_fv) d
   WHERE v.feed_version_id = p_fv;

  DELETE FROM transit_staging.agency         WHERE feed_version_id = p_fv;
  DELETE FROM transit_staging.routes         WHERE feed_version_id = p_fv;
  DELETE FROM transit_staging.stops          WHERE feed_version_id = p_fv;
  DELETE FROM transit_staging.trips          WHERE feed_version_id = p_fv;
  DELETE FROM transit_staging.stop_times     WHERE feed_version_id = p_fv;
  DELETE FROM transit_staging.calendar       WHERE feed_version_id = p_fv;
  DELETE FROM transit_staging.calendar_dates WHERE feed_version_id = p_fv;
END $$;
COMMENT ON PROCEDURE transit.promote_feed(integer) IS 'Staging to core for one feed version: type conversion, key assignment, quality gates. All or nothing.';
DROP FUNCTION transit.analyze_feed_tables();
