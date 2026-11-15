# DASIAH (Transit Accessibility Heatmap)

Web service that shows, for an address, where in the city public transport is about as fast as a
car and where it is not. The city is split into H3 hexagons; each one is coloured by the ratio of
travel time by public transport to travel time by car. Pilot cities: Warsaw and Vilnius. Data:
open GTFS timetables and OpenStreetMap.

## Structure

- `specs/microservices.md` — the services in one page: what each does, stack, where the code is,
  a simple diagram, how to run (Docker, development, tests, a VPS with Terraform).
- `specs/database.md` — the database in one page: schemas, design, integrity, roles, masking,
  layers, migrations, test data, and commands to check it.
- `docs/` — product scope, architecture, database design, contracts, algorithms, runtime, plan.
- `db/` — bootstrap (roles and schemas), reference and test data, SQL smoke test.
- `services/*/migrations/` — schema of each service.
- `AGENTS.md`, `.claude/skills/` — instructions for a coding agent.

## Try it (Docker only)

```bash
docker compose -f compose.setup.yaml run --rm setup   # once: creates .env with random secrets
docker compose up -d --build --wait                    # then open http://localhost:8000
```

Works on Windows, macOS and Linux with nothing but Docker; what to open and check is listed in
[specs/microservices.md](specs/microservices.md#a-docker-compose-recommended).

## Quick start (development)

Needs Node.js 24 (pnpm through `corepack enable`), Docker with Compose, and `psql` on the host.

```bash
cp .env.example .env            # fill in the empty passwords (any random strings locally)
pnpm install
pnpm infra:up                   # PostGIS, RabbitMQ, Redis, Jaeger; bootstrap SQL runs on first start
pnpm db:bootstrap               # idempotent; sets role passwords from .env
pnpm db:migrate                 # node-pg-migrate per service, as app_admin
pnpm db:seed                    # reference data
pnpm db:smoke                   # prints SMOKE TEST PASSED
pnpm db:dict                    # regenerates docs/db/data-dictionary.md
pnpm transit:grid --city waw    # H3 grid from the city boundary (also --city vno)
pnpm db:seed:test               # testville feed (active for waw), demo accounts and data
```

The smoke test expects a database without test data, so run it before `db:seed:test`.
Demo accounts (`demo.user@example.com`, `demo.admin@example.com`, ...) get the password from
`SEED_DEMO_PASSWORD`; if it is empty a random one is printed once.

Each service reads the root `.env` and its own `services/<name>/.env` (copy its `.env.example`;
`DATABASE_URL` uses the service's `svc_*` role).

To see the map: start the services and the gateway (`pnpm --filter @heatmap/<name> dev` for
`identity`, `transit-data`, `accessibility`, `places` and `gateway`; without OSRM data, start the
car-time stub first with `PORT=5000 node services/accessibility/src/test-support/osrm-stub.ts` and
set `OSRM_URL_VNO`/`OSRM_URL_WAW` to it), then `pnpm web:dev` and open http://localhost:5173.

Everything in containers instead (testville as the Warsaw feed, stand-ins for OSRM and the
geocoder): `pnpm full:up`, then http://localhost:8000 (demo accounts as above). End-to-end tests
on a separate, throw-away stack: `pnpm e2e:up && pnpm e2e && pnpm e2e:down` (needs Docker and
Google Chrome).

`pnpm db:reset` drops and recreates the database (fresh start). `pnpm db:migrate down --all`,
`pnpm db:migrate redo --service places` and `pnpm db:psql <role>` are available for development.
