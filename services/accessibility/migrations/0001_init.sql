-- Up Migration
-- accessibility schema: calculation requests, per-cell results, colour classes.
-- No personal data here: the origin is stored only as an H3 cell, and the
-- requesting user is not stored at all (history lives in the places schema).

CREATE DOMAIN accessibility.h3_cell AS text CHECK (VALUE ~ '^8[0-9a-f]{14}$');
CREATE DOMAIN accessibility.city_code AS text CHECK (VALUE ~ '^[a-z]{3}$');

CREATE TABLE accessibility.ratio_classes (
  class_id   smallint PRIMARY KEY,
  code       text NOT NULL UNIQUE CHECK (code ~ '^[a-z_]+$'),
  label      text NOT NULL,
  min_ratio  numeric(5,2),
  max_ratio  numeric(5,2),
  color      char(7) NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
  sort_order smallint NOT NULL UNIQUE,
  CONSTRAINT ratio_classes_bounds CHECK (min_ratio >= 0 AND (max_ratio IS NULL OR max_ratio > min_ratio)),
  CONSTRAINT ratio_classes_special CHECK (min_ratio IS NOT NULL OR max_ratio IS NULL),
  CONSTRAINT ratio_classes_no_overlap EXCLUDE USING gist (numrange(min_ratio, max_ratio) WITH &&) WHERE (min_ratio IS NOT NULL)
);
COMMENT ON TABLE  accessibility.ratio_classes IS 'Reference: legend of the map. Ranged classes cover t_transit/t_car in [min, max); two special classes have no range.';
COMMENT ON COLUMN accessibility.ratio_classes.min_ratio IS 'Inclusive lower bound; NULL for special classes (no_transit, unreachable).';
COMMENT ON COLUMN accessibility.ratio_classes.max_ratio IS 'Exclusive upper bound; NULL = unbounded.';

CREATE TABLE accessibility.feed_snapshots (
  feed_version_id integer PRIMARY KEY,
  city_code       accessibility.city_code NOT NULL,
  valid_from      date NOT NULL,
  valid_to        date NOT NULL,
  loaded_at       timestamptz NOT NULL DEFAULT now(),
  is_current      boolean NOT NULL DEFAULT false,
  CONSTRAINT feed_snapshots_validity CHECK (valid_to >= valid_from)
);
CREATE UNIQUE INDEX feed_snapshots_current_uq ON accessibility.feed_snapshots (city_code) WHERE is_current;
COMMENT ON TABLE  accessibility.feed_snapshots IS 'Timetable versions this service has loaded. feed_version_id is a logical reference to transit.feed_versions (no cross-schema FK); kept in sync by the transit.feed.activated.v1 event.';

CREATE TABLE accessibility.calculations (
  calculation_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_version_id integer NOT NULL REFERENCES accessibility.feed_snapshots (feed_version_id) ON DELETE CASCADE,
  origin_h3       accessibility.h3_cell NOT NULL,
  service_date    date NOT NULL,
  departure_s     integer NOT NULL CHECK (departure_s BETWEEN 0 AND 86399),
  window_s        smallint NOT NULL DEFAULT 0 CHECK (window_s BETWEEN 0 AND 7200),
  algo_version    smallint NOT NULL CHECK (algo_version > 0),
  status          text NOT NULL DEFAULT 'running',
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  expires_at      timestamptz NOT NULL,
  error_code      text,
  CONSTRAINT calculations_status    CHECK (status IN ('running', 'done', 'failed')),
  CONSTRAINT calculations_origin    CHECK (origin_h3 ~ '^8a'),
  CONSTRAINT calculations_completed CHECK ((status = 'running') = (completed_at IS NULL)),
  CONSTRAINT calculations_error     CHECK ((status = 'failed') = (error_code IS NOT NULL)),
  CONSTRAINT calculations_expiry    CHECK (expires_at > created_at)
);
-- Cache key and single-flight guard: the same question is computed once.
CREATE UNIQUE INDEX calculations_cache_uq ON accessibility.calculations
  (feed_version_id, origin_h3, service_date, departure_s, window_s, algo_version)
  WHERE status IN ('running', 'done');
CREATE INDEX calculations_expires_idx ON accessibility.calculations (expires_at);
CREATE INDEX calculations_created_idx ON accessibility.calculations USING brin (created_at);
COMMENT ON TABLE  accessibility.calculations IS 'One accessibility map request. City follows from feed_version_id.';
COMMENT ON COLUMN accessibility.calculations.origin_h3 IS 'Origin snapped to an H3 resolution-10 cell (about 66 m edge): cache key and data minimisation.';
COMMENT ON COLUMN accessibility.calculations.departure_s IS 'Departure time, seconds after local midnight.';
COMMENT ON COLUMN accessibility.calculations.window_s IS '0 = single departure; otherwise departures are sampled over this window and the median is stored.';
COMMENT ON COLUMN accessibility.calculations.algo_version IS 'Bumped when the method changes, so old cached maps are not reused.';

CREATE TABLE accessibility.calculation_results (
  calculation_id uuid NOT NULL REFERENCES accessibility.calculations (calculation_id) ON DELETE CASCADE,
  h3_index       accessibility.h3_cell NOT NULL,
  transit_s      integer CHECK (transit_s >= 0),
  car_s          integer CHECK (car_s > 0),
  has_stop       boolean NOT NULL,
  PRIMARY KEY (calculation_id, h3_index),
  CONSTRAINT calculation_results_no_stop CHECK (has_stop OR transit_s IS NULL)
);
COMMENT ON TABLE  accessibility.calculation_results IS 'Travel times from the origin to one destination cell. Ratio and class are derived in v_calculation_results, not stored.';
COMMENT ON COLUMN accessibility.calculation_results.transit_s IS 'Door-to-door seconds by public transport (or on foot if faster); NULL = not reachable within the limit.';
COMMENT ON COLUMN accessibility.calculation_results.car_s IS 'Free-flow driving seconds; NULL = no road route.';
COMMENT ON COLUMN accessibility.calculation_results.has_stop IS 'false = no stop within walking distance of the cell.';

CREATE TABLE accessibility.outbox (
  event_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   text NOT NULL CHECK (event_type ~ '^[a-z]+(\.[a-z_]+)+\.v[0-9]+$'),
  payload      jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished_idx ON accessibility.outbox (occurred_at) WHERE published_at IS NULL;

CREATE TABLE accessibility.processed_messages (
  message_id   uuid PRIMARY KEY,
  event_type   text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE accessibility.processed_messages IS 'Inbox for idempotent consumers: a message id is handled at most once.';

-- ------------------------------------------------------------ triggers
CREATE FUNCTION accessibility.tg_calculation_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> OLD.status THEN
    IF OLD.status <> 'running' THEN
      RAISE EXCEPTION 'calculation % is already %', OLD.calculation_id, OLD.status USING ERRCODE = 'check_violation';
    END IF;
    NEW.completed_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER calculations_status BEFORE UPDATE OF status ON accessibility.calculations
  FOR EACH ROW EXECUTE FUNCTION accessibility.tg_calculation_status();

-- A new current snapshot replaces the previous one for the same city.
CREATE FUNCTION accessibility.tg_snapshot_current() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_current THEN
    UPDATE accessibility.feed_snapshots SET is_current = false
     WHERE city_code = NEW.city_code AND is_current AND feed_version_id <> NEW.feed_version_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER feed_snapshots_current BEFORE INSERT OR UPDATE OF is_current ON accessibility.feed_snapshots
  FOR EACH ROW EXECUTE FUNCTION accessibility.tg_snapshot_current();

-- ------------------------------------------------------------ functions
CREATE FUNCTION accessibility.purge_expired(p_limit integer DEFAULT 500) RETURNS integer
LANGUAGE sql AS $$
  WITH doomed AS (
    SELECT calculation_id FROM accessibility.calculations
    WHERE expires_at < now() ORDER BY expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), gone AS (
    DELETE FROM accessibility.calculations c USING doomed d
    WHERE c.calculation_id = d.calculation_id RETURNING 1
  )
  SELECT count(*)::int FROM gone;
$$;
COMMENT ON FUNCTION accessibility.purge_expired(integer) IS 'Deletes expired calculations with their results (cascade), oldest first. Returns the number removed. Called on a timer by the service.';

-- ------------------------------------------------------------ views
CREATE VIEW accessibility.v_calculation_results AS
SELECT r.calculation_id, r.h3_index, r.transit_s, r.car_s,
       round(r.transit_s::numeric / r.car_s, 2) AS ratio,
       rc.code AS class_code, rc.color
FROM accessibility.calculation_results r
JOIN accessibility.ratio_classes rc
  ON CASE
       WHEN NOT r.has_stop THEN rc.code = 'no_transit'
       WHEN r.transit_s IS NULL OR r.car_s IS NULL THEN rc.code = 'unreachable'
       ELSE rc.min_ratio IS NOT NULL
            AND numrange(rc.min_ratio, rc.max_ratio) @> round(r.transit_s::numeric / r.car_s, 2)
     END;
COMMENT ON VIEW accessibility.v_calculation_results IS 'Results with the derived ratio and legend class. This is what the API returns.';

CREATE VIEW accessibility.v_daily_usage AS
SELECT date_trunc('day', c.created_at)::date AS day,
       s.city_code,
       count(*)                                  AS calculations,
       count(*) FILTER (WHERE c.status = 'failed') AS failed,
       round(avg(extract(epoch FROM c.completed_at - c.created_at) * 1000) FILTER (WHERE c.status = 'done')) AS avg_ms,
       round((percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM c.completed_at - c.created_at) * 1000)
              FILTER (WHERE c.status = 'done'))::numeric) AS p95_ms
FROM accessibility.calculations c
JOIN accessibility.feed_snapshots s USING (feed_version_id)
GROUP BY 1, 2;
COMMENT ON VIEW accessibility.v_daily_usage IS 'Calculations per day and city with average and p95 duration (KPI: response time).';

-- Down Migration
DROP VIEW accessibility.v_daily_usage;
DROP VIEW accessibility.v_calculation_results;
DROP FUNCTION accessibility.purge_expired(integer);
DROP TABLE accessibility.processed_messages, accessibility.outbox, accessibility.calculation_results,
           accessibility.calculations, accessibility.feed_snapshots, accessibility.ratio_classes;
DROP FUNCTION accessibility.tg_snapshot_current();
DROP FUNCTION accessibility.tg_calculation_status();
DROP DOMAIN accessibility.city_code;
DROP DOMAIN accessibility.h3_cell;
