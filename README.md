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

## Quick start

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
pnpm db:seed:test               # testville feed (active for waw), demo accounts and data
```

The smoke test expects a database without test data, so run it before `db:seed:test`.
Demo accounts (`demo.user@example.com`, `demo.admin@example.com`, ...) get the password from
`SEED_DEMO_PASSWORD`; if it is empty a random one is printed once.

`pnpm db:reset` drops and recreates the database (fresh start). `pnpm db:migrate down --all`,
`pnpm db:migrate redo --service places` and `pnpm db:psql <role>` are available for development.
