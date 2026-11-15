-- Bootstrap: extensions, roles, schemas, default privileges.
-- Run ONCE per database by a superuser (the only time a superuser is used).
-- Idempotent. Passwords are NOT set here: see scripts/db-set-passwords.sh.
--
--   psql -U postgres -d heatmap -v ON_ERROR_STOP=1 -f db/bootstrap/001_roles_schemas.sql

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------- roles
-- Group roles (NOLOGIN) carry privileges; login roles only inherit.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY[
    'app_read',          -- read-only, personal data only through masked views
    'app_write',         -- union of all *_rw roles, for operator tooling
    'identity_rw', 'transit_rw', 'accessibility_rw', 'places_rw'
  ] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;

  FOREACH r IN ARRAY ARRAY[
    'app_admin',         -- owns schemas and objects, runs migrations; NOT superuser
    'svc_identity', 'svc_transit', 'svc_accessibility', 'svc_places',
    'reporting'          -- human / BI read-only login
  ] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', r);
    END IF;
  END LOOP;
END $$;

GRANT identity_rw      TO svc_identity;
GRANT transit_rw       TO svc_transit;
GRANT accessibility_rw TO svc_accessibility;
GRANT places_rw        TO svc_places;
GRANT app_read         TO reporting;
GRANT identity_rw, transit_rw, accessibility_rw, places_rw TO app_write;

ALTER ROLE svc_identity      SET search_path = identity, public;
ALTER ROLE svc_transit       SET search_path = transit, public;
ALTER ROLE svc_accessibility SET search_path = accessibility, public;
ALTER ROLE svc_places        SET search_path = places, public;

-- ---------------------------------------------------------------- database / public
REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"DBNAME" TO app_admin, app_read, app_write,
  identity_rw, transit_rw, accessibility_rw, places_rw;
GRANT TEMPORARY ON DATABASE :"DBNAME" TO transit_rw;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ---------------------------------------------------------------- schemas
CREATE SCHEMA IF NOT EXISTS identity        AUTHORIZATION app_admin;
CREATE SCHEMA IF NOT EXISTS transit         AUTHORIZATION app_admin;
CREATE SCHEMA IF NOT EXISTS transit_staging AUTHORIZATION app_admin;
CREATE SCHEMA IF NOT EXISTS accessibility   AUTHORIZATION app_admin;
CREATE SCHEMA IF NOT EXISTS places          AUTHORIZATION app_admin;

GRANT USAGE ON SCHEMA identity        TO identity_rw, app_read;
GRANT USAGE ON SCHEMA transit         TO transit_rw, app_read;
GRANT USAGE ON SCHEMA transit_staging TO transit_rw;
GRANT USAGE ON SCHEMA accessibility   TO accessibility_rw, app_read;
GRANT USAGE ON SCHEMA places          TO places_rw, app_read;

-- ---------------------------------------------------------------- default privileges
-- Applied automatically to every object app_admin creates later, so a new
-- table never ships without grants. Functions are NOT executable by PUBLIC.
ALTER DEFAULT PRIVILEGES FOR ROLE app_admin REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $$
DECLARE s text; rw text;
BEGIN
  FOR s, rw IN VALUES
    ('identity','identity_rw'), ('transit','transit_rw'), ('transit_staging','transit_rw'),
    ('accessibility','accessibility_rw'), ('places','places_rw')
  LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', s, rw);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %I', s, rw);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO %I', s, rw);
  END LOOP;
END $$;

-- app_read: automatic SELECT only where there is no personal data.
-- In identity and places it gets explicit grants on masked views only.
ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA transit       GRANT SELECT ON TABLES TO app_read;
ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA accessibility GRANT SELECT ON TABLES TO app_read;

COMMENT ON SCHEMA identity        IS 'Owned by identity-service: accounts, sessions, audit trail.';
COMMENT ON SCHEMA transit         IS 'Owned by transit-data-service: cities, GTFS feed versions, timetable (core layer), H3 grid and access mart.';
COMMENT ON SCHEMA transit_staging IS 'Owned by transit-data-service: GTFS files as loaded, text columns, no constraints (staging layer). Emptied after each import.';
COMMENT ON SCHEMA accessibility   IS 'Owned by accessibility-service: calculation requests, per-cell results, legend.';
COMMENT ON SCHEMA places          IS 'Owned by places-service: geocoding cache, saved places, search history.';
