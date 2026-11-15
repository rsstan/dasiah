# Agent guide

Transit Accessibility Heatmap: a web service that, for an address in Warsaw or Vilnius, colours the
city by how much slower public transport is than a car (`t_transit / t_car` per H3 cell).
This is a diploma project, so the repository has to work and also has to show evidence for a
fixed list of grading requirements (`docs/07-requirements-matrix.md`).

## Read first

| File | Use it for |
| --- | --- |
| `docs/plan.md` | What to build next. Work strictly in this order, one step at a time. |
| `docs/02-architecture.md` | Services, boundaries, gateway, cross-cutting rules. |
| `docs/03-database.md` | Schemas, roles, layers, integrity rules. |
| `docs/04-contracts.md` | REST endpoints and events. |
| `docs/05-algorithms.md` | GTFS import, grid, RAPTOR, car times, ratio. |
| `docs/06-runtime.md` | Local stack, configuration, logging, tracing, deployment. |
| `docs/07-requirements-matrix.md` | Grading requirement -> where it is satisfied. Keep it current. |
| `.claude/skills/*/SKILL.md` | Procedures for recurring work (DB change, endpoint, event, new service, verification). |

## Rules that do not bend

1. **Service boundaries.** A service reads and writes only its own schema with its own database
   role. No cross-schema queries, joins or foreign keys. Other services' data comes through their
   HTTP API or through events.
2. **No superuser at runtime.** Services connect as `svc_*`, migrations as `app_admin`. The
   superuser is used only for `db/bootstrap`.
3. **SQL-first schema.** Every structural change is a migration file in
   `services/<name>/migrations/`. Never change a database by hand and never edit a migration that
   is already merged; add a new one.
4. **Contract first.** Change `contracts/openapi/*.yaml` or `contracts/asyncapi/*.yaml` before
   the code, then regenerate types.
5. **Passwords and secrets.** User passwords are hashed with Argon2id in the application. No
   secrets, real passwords or real personal data in Git; `.env.example` holds names only.
6. **Every request is traceable.** Each log line carries `correlation_id`; it is propagated over
   HTTP (`X-Correlation-Id`) and in message headers.
7. **Docs move with code.** A step is not done until the affected doc, the data dictionary and
   the requirements matrix are updated.

## Working loop

1. Take the first unchecked step in `docs/plan.md`. Read its "Done when".
2. If a matching skill exists, follow it.
3. Implement with tests. Run the `verify` skill.
4. Tick the step in `docs/plan.md`, commit (`feat(scope): ...`, one step per commit or PR).
5. Stop and ask the user when: a decision in `docs/02-architecture.md#decisions` would have to
   change, an external data source behaves differently from the docs, or a step cannot meet its
   "Done when".

## Stack

TypeScript (strict), Node.js LTS, pnpm workspaces, Fastify, Kysely + `pg`, node-pg-migrate with
plain SQL files, PostgreSQL 16 + PostGIS, RabbitMQ, Redis (gateway rate limits), OSRM,
OpenTelemetry + Jaeger, pino, Vitest, Testcontainers, React + Vite + MapLibre GL JS, Docker
Compose, GitHub Actions. Use the current stable release of each tool and check its documentation
for exact flags; versions are pinned in `package.json` and image tags, not here.

## Repository layout (target)

```
apps/gateway/                 API gateway (routing, JWT check, rate limits)
apps/web/                     React frontend
services/identity/            accounts and tokens          -> schema identity
services/transit-data/        GTFS import, grid            -> schemas transit, transit_staging
services/accessibility/       RAPTOR + OSRM, heatmap data  -> schema accessibility
services/places/              geocoding, saved places      -> schema places
services/<name>/migrations/   SQL migrations of that service
packages/common/              config, logger, tracing, HTTP server/client, messaging
packages/contracts/           types generated from OpenAPI / AsyncAPI
contracts/openapi/            one file per service + gateway
contracts/asyncapi/           heatmap-events.yaml
db/bootstrap/                 roles, schemas, extensions (superuser, once)
db/seed/reference/            fixed reference data
db/seed/test/                 demo and edge-case data
db/tests/                     SQL smoke test
fixtures/gtfs/testville/      tiny synthetic GTFS feed for tests
infra/                        docker compose, OSRM build, OTel collector, deployment
docs/                         specifications and plan
```

## Conventions

- SQL: `snake_case`, singular column names, plural table names, constraint names
  `<table>_<meaning>`, every table and every non-obvious column has `COMMENT ON`.
- TypeScript: no `any`, no default exports, errors as typed classes mapped to
  `application/problem+json`.
- API: JSON `camelCase`, timestamps ISO 8601 UTC, durations in seconds, coordinates `{lat, lon}`.
- Tests sit next to the code as `*.test.ts`; integration tests as `*.itest.ts`.
- Language of code, comments, docs and commits: English.
