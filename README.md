# Transit Accessibility Heatmap

Web service that shows, for an address, where in the city public transport is about as fast as a
car and where it is not. The city is split into H3 hexagons; each one is coloured by the ratio of
travel time by public transport to travel time by car. Pilot cities: Warsaw and Vilnius. Data:
open GTFS timetables and OpenStreetMap.

## Status

Specification and database layer are in place; services are built step by step following
`docs/plan.md`.

## Structure

- `docs/` — product scope, architecture, database design, contracts, algorithms, runtime, plan.
- `db/` — bootstrap (roles and schemas), reference and test data, SQL smoke test.
- `services/*/migrations/` — schema of each service.
- `AGENTS.md`, `.claude/skills/` — instructions for a coding agent.

## Database quick start

Needs PostgreSQL 16 with PostGIS.

```bash
createdb -U postgres heatmap
psql -U postgres -d heatmap -v ON_ERROR_STOP=1 -f db/bootstrap/001_roles_schemas.sql
./scripts/db-set-passwords.sh                      # reads DB_PASSWORD_* from the environment
# migrations: the part of each file between "-- Up Migration" and "-- Down Migration",
# applied as app_admin (node-pg-migrate does this once phase 0 is done)
for f in db/seed/reference/*.sql; do psql -U app_admin -d heatmap -v ON_ERROR_STOP=1 -f "$f"; done
psql -U postgres -d heatmap -v ON_ERROR_STOP=1 -f db/tests/smoke.sql
```
