-- Up Migration
-- transit schema: cities, GTFS feed versions, normalized timetable, H3 grid.
-- Layers: raw (zip in object storage + feed_versions row)
--      -> staging (transit_staging.*, text columns, loaded with COPY)
--      -> core (transit.*, typed and constrained, filled by promote_feed())
--      -> mart (hex_stop_access, mv_city_coverage; what other services consume).

CREATE DOMAIN transit.h3_cell AS text CHECK (VALUE ~ '^8[0-9a-f]{14}$');
COMMENT ON DOMAIN transit.h3_cell IS 'H3 cell index as 15 hex characters.';
CREATE DOMAIN transit.gtfs_seconds AS integer CHECK (VALUE BETWEEN 0 AND 172800);
COMMENT ON DOMAIN transit.gtfs_seconds IS 'Seconds after noon-minus-12h of the service day. GTFS allows times past 24:00:00.';

-- ------------------------------------------------------------ reference
CREATE TABLE transit.route_types (
  route_type_id smallint PRIMARY KEY,
  code          text NOT NULL UNIQUE CHECK (code ~ '^[a-z_]+$'),
  name          text NOT NULL
);
COMMENT ON TABLE transit.route_types IS 'Reference: GTFS route_type codes (0 tram, 1 metro, 2 rail, 3 bus, ...).';

CREATE TABLE transit.cities (
  city_id       smallint PRIMARY KEY,
  code          text NOT NULL UNIQUE CHECK (code ~ '^[a-z]{3}$'),
  name          text NOT NULL,
  country_code  char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  timezone      text NOT NULL,
  h3_resolution smallint NOT NULL DEFAULT 9 CHECK (h3_resolution BETWEEN 7 AND 10),
  bounds        geometry(Polygon, 4326) NOT NULL CHECK (ST_IsValid(bounds)),
  is_enabled    boolean NOT NULL DEFAULT true
);
COMMENT ON TABLE  transit.cities IS 'Reference: supported cities.';
COMMENT ON COLUMN transit.cities.bounds IS 'Area covered by the hexagon grid (WGS 84).';

CREATE TABLE transit.feed_sources (
  feed_source_id smallint PRIMARY KEY,
  city_id        smallint NOT NULL REFERENCES transit.cities (city_id),
  code           text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]+$'),
  name           text NOT NULL,
  url            text NOT NULL CHECK (url ~ '^https?://'),
  license        text NOT NULL,
  is_enabled     boolean NOT NULL DEFAULT true
);
CREATE INDEX feed_sources_city_idx ON transit.feed_sources (city_id);
COMMENT ON TABLE transit.feed_sources IS 'Reference: where GTFS feeds are downloaded from.';

-- ------------------------------------------------------------ feed versions (raw layer metadata)
CREATE TABLE transit.feed_versions (
  feed_version_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  feed_source_id  smallint NOT NULL REFERENCES transit.feed_sources (feed_source_id),
  sha256          bytea NOT NULL CHECK (octet_length(sha256) = 32),
  storage_key     text NOT NULL,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  valid_from      date,
  valid_to        date,
  status          text NOT NULL DEFAULT 'downloaded',
  activated_at    timestamptz,
  archived_at     timestamptz,
  error_message   text,
  CONSTRAINT feed_versions_content_uq UNIQUE (feed_source_id, sha256),
  CONSTRAINT feed_versions_status CHECK (status IN ('downloaded','staged','validated','active','archived','failed')),
  CONSTRAINT feed_versions_validity CHECK (valid_to >= valid_from),
  CONSTRAINT feed_versions_error CHECK ((status = 'failed') = (error_message IS NOT NULL))
);
CREATE UNIQUE INDEX feed_versions_one_active_uq ON transit.feed_versions (feed_source_id) WHERE status = 'active';
COMMENT ON TABLE  transit.feed_versions IS 'One row per downloaded GTFS archive. At most one active version per source.';
COMMENT ON COLUMN transit.feed_versions.sha256 IS 'Hash of the zip; the same archive is never imported twice.';
COMMENT ON COLUMN transit.feed_versions.storage_key IS 'Object-storage key of the original zip (raw layer).';

-- ------------------------------------------------------------ core GTFS (3NF)
-- Every table is keyed by (feed_version_id, local id). Composite foreign keys
-- make references across feed versions impossible.
CREATE TABLE transit.agencies (
  feed_version_id integer  NOT NULL REFERENCES transit.feed_versions ON DELETE CASCADE,
  agency_id       smallint NOT NULL,
  gtfs_id         text NOT NULL,
  name            text NOT NULL,
  PRIMARY KEY (feed_version_id, agency_id),
  UNIQUE (feed_version_id, gtfs_id)
);

CREATE TABLE transit.routes (
  feed_version_id integer  NOT NULL,
  route_id        integer  NOT NULL,
  agency_id       smallint NOT NULL,
  gtfs_id         text NOT NULL,
  short_name      text,
  long_name       text,
  route_type_id   smallint NOT NULL REFERENCES transit.route_types (route_type_id),
  PRIMARY KEY (feed_version_id, route_id),
  UNIQUE (feed_version_id, gtfs_id),
  FOREIGN KEY (feed_version_id, agency_id) REFERENCES transit.agencies ON DELETE CASCADE,
  CONSTRAINT routes_has_name CHECK (short_name IS NOT NULL OR long_name IS NOT NULL)
);

CREATE TABLE transit.stops (
  feed_version_id integer NOT NULL REFERENCES transit.feed_versions ON DELETE CASCADE,
  stop_id         integer NOT NULL,
  gtfs_id         text NOT NULL,
  name            text NOT NULL,
  geom            geography(Point, 4326) NOT NULL,
  PRIMARY KEY (feed_version_id, stop_id),
  UNIQUE (feed_version_id, gtfs_id)
);
CREATE INDEX stops_geom_gix ON transit.stops USING gist (geom);

CREATE TABLE transit.services (
  feed_version_id integer NOT NULL REFERENCES transit.feed_versions ON DELETE CASCADE,
  service_id      integer NOT NULL,
  gtfs_id         text NOT NULL,
  PRIMARY KEY (feed_version_id, service_id),
  UNIQUE (feed_version_id, gtfs_id)
);

CREATE TABLE transit.service_dates (
  feed_version_id integer NOT NULL,
  service_id      integer NOT NULL,
  service_date    date NOT NULL,
  PRIMARY KEY (feed_version_id, service_id, service_date),
  FOREIGN KEY (feed_version_id, service_id) REFERENCES transit.services ON DELETE CASCADE
);
CREATE INDEX service_dates_date_idx ON transit.service_dates (feed_version_id, service_date);
COMMENT ON TABLE transit.service_dates IS 'Days on which a service runs: calendar.txt expanded, calendar_dates.txt applied.';

CREATE TABLE transit.trips (
  feed_version_id integer NOT NULL,
  trip_id         integer NOT NULL,
  route_id        integer NOT NULL,
  service_id      integer NOT NULL,
  gtfs_id         text NOT NULL,
  headsign        text,
  direction       smallint CHECK (direction IN (0, 1)),
  PRIMARY KEY (feed_version_id, trip_id),
  UNIQUE (feed_version_id, gtfs_id),
  FOREIGN KEY (feed_version_id, route_id)   REFERENCES transit.routes   ON DELETE CASCADE,
  FOREIGN KEY (feed_version_id, service_id) REFERENCES transit.services ON DELETE CASCADE
);
CREATE INDEX trips_route_idx   ON transit.trips (feed_version_id, route_id);
CREATE INDEX trips_service_idx ON transit.trips (feed_version_id, service_id);

CREATE TABLE transit.stop_times (
  feed_version_id integer  NOT NULL,
  trip_id         integer  NOT NULL,
  stop_sequence   smallint NOT NULL CHECK (stop_sequence >= 0),
  stop_id         integer  NOT NULL,
  arrival_s       transit.gtfs_seconds NOT NULL,
  departure_s     transit.gtfs_seconds NOT NULL,
  PRIMARY KEY (feed_version_id, trip_id, stop_sequence),
  FOREIGN KEY (feed_version_id, trip_id) REFERENCES transit.trips ON DELETE CASCADE,
  FOREIGN KEY (feed_version_id, stop_id) REFERENCES transit.stops ON DELETE CASCADE,
  CONSTRAINT stop_times_dwell CHECK (departure_s >= arrival_s)
);
CREATE INDEX stop_times_stop_idx ON transit.stop_times (feed_version_id, stop_id, departure_s);

CREATE TABLE transit.transfers (
  feed_version_id integer  NOT NULL,
  from_stop_id    integer  NOT NULL,
  to_stop_id      integer  NOT NULL,
  walk_s          smallint NOT NULL CHECK (walk_s BETWEEN 1 AND 1800),
  PRIMARY KEY (feed_version_id, from_stop_id, to_stop_id),
  FOREIGN KEY (feed_version_id, from_stop_id) REFERENCES transit.stops ON DELETE CASCADE,
  FOREIGN KEY (feed_version_id, to_stop_id)   REFERENCES transit.stops ON DELETE CASCADE,
  CONSTRAINT transfers_not_self CHECK (from_stop_id <> to_stop_id)
);
COMMENT ON TABLE transit.transfers IS 'Walking links between nearby stops (RAPTOR footpaths). Built by rebuild_transfers().';

-- ------------------------------------------------------------ grid and mart
CREATE TABLE transit.hex_cells (
  h3_index transit.h3_cell PRIMARY KEY,
  city_id  smallint NOT NULL REFERENCES transit.cities (city_id),
  centroid geography(Point, 4326) NOT NULL
);
CREATE INDEX hex_cells_city_idx ON transit.hex_cells (city_id);
CREATE INDEX hex_cells_centroid_gix ON transit.hex_cells USING gist (centroid);
COMMENT ON TABLE transit.hex_cells IS 'H3 cells covering each city at cities.h3_resolution. Generated by the service with h3-js.';

CREATE TABLE transit.hex_stop_access (
  feed_version_id integer NOT NULL,
  h3_index        transit.h3_cell NOT NULL REFERENCES transit.hex_cells ON DELETE CASCADE,
  stop_id         integer NOT NULL,
  walk_s          smallint NOT NULL CHECK (walk_s BETWEEN 0 AND 1800),
  PRIMARY KEY (feed_version_id, h3_index, stop_id),
  FOREIGN KEY (feed_version_id, stop_id) REFERENCES transit.stops ON DELETE CASCADE
);
COMMENT ON TABLE transit.hex_stop_access IS 'Mart: nearest stops of every cell with walking time. Recomputed for each feed version.';

CREATE TABLE transit.outbox (
  event_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   text NOT NULL CHECK (event_type ~ '^[a-z]+(\.[a-z_]+)+\.v[0-9]+$'),
  payload      jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished_idx ON transit.outbox (occurred_at) WHERE published_at IS NULL;

-- ------------------------------------------------------------ staging (text, no constraints)
CREATE UNLOGGED TABLE transit_staging.agency         (feed_version_id integer NOT NULL, agency_id text, agency_name text, agency_timezone text);
CREATE UNLOGGED TABLE transit_staging.routes         (feed_version_id integer NOT NULL, route_id text, agency_id text, route_short_name text, route_long_name text, route_type text);
CREATE UNLOGGED TABLE transit_staging.stops          (feed_version_id integer NOT NULL, stop_id text, stop_name text, stop_lat text, stop_lon text, location_type text);
CREATE UNLOGGED TABLE transit_staging.trips          (feed_version_id integer NOT NULL, trip_id text, route_id text, service_id text, trip_headsign text, direction_id text);
CREATE UNLOGGED TABLE transit_staging.stop_times     (feed_version_id integer NOT NULL, trip_id text, stop_sequence text, stop_id text, arrival_time text, departure_time text);
CREATE UNLOGGED TABLE transit_staging.calendar       (feed_version_id integer NOT NULL, service_id text, monday text, tuesday text, wednesday text, thursday text, friday text, saturday text, sunday text, start_date text, end_date text);
CREATE UNLOGGED TABLE transit_staging.calendar_dates (feed_version_id integer NOT NULL, service_id text, date text, exception_type text);
CREATE INDEX ON transit_staging.stop_times (feed_version_id);

-- ------------------------------------------------------------ functions
CREATE FUNCTION transit.gtfs_time_to_seconds(p_time text) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT split_part(btrim(p_time), ':', 1)::int * 3600
       + split_part(btrim(p_time), ':', 2)::int * 60
       + split_part(btrim(p_time), ':', 3)::int
$$;
COMMENT ON FUNCTION transit.gtfs_time_to_seconds(text) IS '''25:10:00'' -> 90600. Hours may exceed 23.';

CREATE FUNCTION transit.walk_seconds(p_meters double precision) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ceil(p_meters * 1.3 / 1.389)::int   -- detour factor 1.3, walking speed 5 km/h
$$;
COMMENT ON FUNCTION transit.walk_seconds(double precision) IS 'Straight-line metres to walking seconds. Single place where the walking model lives in SQL.';

-- Status machine of a feed version.
CREATE FUNCTION transit.tg_feed_version_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
       (OLD.status = 'downloaded' AND NEW.status IN ('staged', 'failed'))
    OR (OLD.status = 'staged'     AND NEW.status IN ('validated', 'failed'))
    OR (OLD.status = 'validated'  AND NEW.status IN ('active', 'archived', 'failed'))
    OR (OLD.status = 'active'     AND NEW.status = 'archived')
  ) THEN
    RAISE EXCEPTION 'feed version %: illegal status change % -> %', OLD.feed_version_id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'active'   THEN NEW.activated_at := now(); END IF;
  IF NEW.status = 'archived' THEN NEW.archived_at  := now(); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER feed_versions_status BEFORE UPDATE OF status ON transit.feed_versions
  FOR EACH ROW EXECUTE FUNCTION transit.tg_feed_version_status();

-- staging -> core. Call inside one transaction; any bad row aborts the import.
CREATE PROCEDURE transit.promote_feed(p_fv integer)
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

CREATE PROCEDURE transit.rebuild_transfers(p_fv integer, p_max_m integer DEFAULT 300)
LANGUAGE sql AS $$
  DELETE FROM transit.transfers WHERE feed_version_id = p_fv;
  INSERT INTO transit.transfers (feed_version_id, from_stop_id, to_stop_id, walk_s)
  SELECT p_fv, a.stop_id, b.stop_id, greatest(transit.walk_seconds(ST_Distance(a.geom, b.geom)), 1)
  FROM transit.stops a
  JOIN transit.stops b
    ON b.feed_version_id = a.feed_version_id AND b.stop_id <> a.stop_id
   AND ST_DWithin(a.geom, b.geom, p_max_m)
  WHERE a.feed_version_id = p_fv;
$$;

CREATE PROCEDURE transit.rebuild_hex_stop_access(p_fv integer, p_max_m integer DEFAULT 1500, p_k integer DEFAULT 5)
LANGUAGE sql AS $$
  DELETE FROM transit.hex_stop_access WHERE feed_version_id = p_fv;
  INSERT INTO transit.hex_stop_access (feed_version_id, h3_index, stop_id, walk_s)
  SELECT p_fv, h.h3_index, n.stop_id, transit.walk_seconds(n.dist_m)
  FROM transit.feed_versions v
  JOIN transit.feed_sources fs USING (feed_source_id)
  JOIN transit.hex_cells h ON h.city_id = fs.city_id
  CROSS JOIN LATERAL (
    SELECT s.stop_id, ST_Distance(s.geom, h.centroid) AS dist_m
    FROM transit.stops s
    WHERE s.feed_version_id = p_fv AND ST_DWithin(s.geom, h.centroid, p_max_m)
    ORDER BY s.geom <-> h.centroid
    LIMIT p_k
  ) n
  WHERE v.feed_version_id = p_fv;
$$;
COMMENT ON PROCEDURE transit.rebuild_hex_stop_access(integer, integer, integer) IS 'For every cell of the feed''s city: up to p_k stops within p_max_m metres, with walking time.';

-- ------------------------------------------------------------ views
CREATE VIEW transit.v_active_feeds AS
SELECT c.code AS city_code, fs.code AS source_code, v.feed_version_id,
       v.valid_from, v.valid_to, v.activated_at
FROM transit.feed_versions v
JOIN transit.feed_sources fs USING (feed_source_id)
JOIN transit.cities c USING (city_id)
WHERE v.status = 'active';
COMMENT ON VIEW transit.v_active_feeds IS 'The feed version currently served for each source.';

CREATE MATERIALIZED VIEW transit.mv_city_coverage AS
SELECT c.code AS city_code,
       v.feed_version_id,
       (SELECT count(*) FROM transit.hex_cells h WHERE h.city_id = c.city_id)                              AS hex_total,
       (SELECT count(DISTINCT a.h3_index) FROM transit.hex_stop_access a WHERE a.feed_version_id = v.feed_version_id) AS hex_with_stop,
       (SELECT count(*) FROM transit.stops s  WHERE s.feed_version_id = v.feed_version_id)                 AS stops,
       (SELECT count(*) FROM transit.routes r WHERE r.feed_version_id = v.feed_version_id)                 AS routes,
       (SELECT count(*) FROM transit.trips t  WHERE t.feed_version_id = v.feed_version_id)                 AS trips
FROM transit.feed_versions v
JOIN transit.feed_sources fs USING (feed_source_id)
JOIN transit.cities c USING (city_id)
WHERE v.status = 'active'
WITH NO DATA;
CREATE UNIQUE INDEX mv_city_coverage_uq ON transit.mv_city_coverage (feed_version_id);
COMMENT ON MATERIALIZED VIEW transit.mv_city_coverage IS 'Per active feed: grid size, cells with a stop in walking distance, network size. Refreshed by activate_feed().';

-- Switch the served version. One transaction: archive old, activate new, emit event.
-- SECURITY DEFINER because only the owner may refresh the materialized view.
CREATE PROCEDURE transit.activate_feed(p_fv integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = transit, public, pg_temp AS $$
DECLARE v_source smallint; v_city text; v_from date; v_to date;
BEGIN
  SELECT v.feed_source_id, c.code, v.valid_from, v.valid_to INTO v_source, v_city, v_from, v_to
  FROM transit.feed_versions v
  JOIN transit.feed_sources fs USING (feed_source_id)
  JOIN transit.cities c USING (city_id)
  WHERE v.feed_version_id = p_fv AND v.status = 'validated'
  FOR UPDATE OF v;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'feed version % is not in status validated', p_fv;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM transit.hex_stop_access WHERE feed_version_id = p_fv) THEN
    RAISE EXCEPTION 'feed version %: hex_stop_access is empty, run rebuild_hex_stop_access first', p_fv;
  END IF;

  UPDATE transit.feed_versions SET status = 'archived'
   WHERE feed_source_id = v_source AND status = 'active';
  UPDATE transit.feed_versions SET status = 'active' WHERE feed_version_id = p_fv;

  INSERT INTO transit.outbox (event_type, payload)
  VALUES ('transit.feed.activated.v1',
          jsonb_build_object('cityCode', v_city, 'feedVersionId', p_fv, 'validFrom', v_from, 'validTo', v_to));

  REFRESH MATERIALIZED VIEW transit.mv_city_coverage;
END $$;
COMMENT ON PROCEDURE transit.activate_feed(integer) IS 'Makes a validated feed version the active one and publishes transit.feed.activated.v1.';

-- Down Migration
DROP PROCEDURE transit.activate_feed(integer);
DROP MATERIALIZED VIEW transit.mv_city_coverage;
DROP VIEW transit.v_active_feeds;
DROP PROCEDURE transit.rebuild_hex_stop_access(integer, integer, integer);
DROP PROCEDURE transit.rebuild_transfers(integer, integer);
DROP PROCEDURE transit.promote_feed(integer);
DROP TABLE transit_staging.agency, transit_staging.routes, transit_staging.stops, transit_staging.trips,
           transit_staging.stop_times, transit_staging.calendar, transit_staging.calendar_dates;
DROP TABLE transit.outbox, transit.hex_stop_access, transit.hex_cells, transit.transfers, transit.stop_times,
           transit.trips, transit.service_dates, transit.services, transit.stops, transit.routes,
           transit.agencies, transit.feed_versions, transit.feed_sources, transit.cities, transit.route_types;
DROP FUNCTION transit.tg_feed_version_status();
DROP FUNCTION transit.walk_seconds(double precision);
DROP FUNCTION transit.gtfs_time_to_seconds(text);
DROP DOMAIN transit.gtfs_seconds;
DROP DOMAIN transit.h3_cell;
