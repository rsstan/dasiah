# 6. Runtime: local stack, configuration, observability, CI, deployment

## Local stack (`infra/compose/docker-compose.yml`)

| Container | Image (pin a tag) | Port | Notes |
| --- | --- | --- | --- |
| `postgres` | `postgis/postgis:16-*` | 5432 | `db/bootstrap` mounted into `/docker-entrypoint-initdb.d`; data volume |
| `db-migrate` | built from repo | – | One-shot: set role passwords, run all service migrations as `app_admin`, load reference data |
| `rabbitmq` | `rabbitmq:*-management` | 5672, 15672 | Exchanges, queues and DLX are declared by the services from the topology in `contracts/asyncapi` |
| `redis` | `redis:*-alpine` | 6379 | Gateway rate limits only |
| `osrm-waw`, `osrm-vno` | `ghcr.io/project-osrm/osrm-backend:v26.4.0` | 5001, 5002 | Profile `osrm`. Data prepared by `infra/osrm/build.sh <city>` (Geofabrik extract, MLD) into `infra/osrm/data/<city>`; without data use the stub `node services/accessibility/src/test-support/osrm-stub.ts` |
| `jaeger` | `jaegertracing/jaeger` (v2) | 16686, 4318 | OTLP HTTP in, UI out |
| `identity`, `transit-data`, `accessibility`, `places` | built from repo | 3001–3004 | Not published to the host in the demo profile |
| `gateway` | built from repo | 8080 | The only published API port |
| `web` | built from repo | 5173 | Vite dev server locally, static files in production |

Profiles: `infra` (databases, broker, tracing, OSRM) for running services with `pnpm dev`;
`full` for everything in containers.

Host ports come from `.env` (`PG_PORT`, `AMQP_PORT`, `REDIS_PORT`, ...), so the stack can run next to
another local PostgreSQL. `scripts/with-env.sh` exports `.env` and the matching `PG*` variables;
`scripts/db-as.sh <role>` runs `psql` as a role with its password from the environment.

First start: `pnpm infra:up` (bootstrap SQL runs on an empty volume), then `pnpm db:passwords`.

City grids: `pnpm transit:grid --city waw` (and `vno`) after the first migration. GTFS by hand:
`pnpm transit:import --source waw_ztm --file data/gtfs/<file>.zip --activate` (`data/` is ignored by Git).

Root scripts (`package.json`): `dev`, `build`, `lint`, `typecheck`, `test`, `test:int`,
`db:bootstrap`, `db:migrate`, `db:seed`, `db:seed:test`, `db:smoke`, `db:dict`,
`contracts:lint`, `contracts:gen`, `e2e`.

## Configuration

Environment variables, validated at start with a schema; `.env.example` lists all names.

| Variable | Used by | Meaning |
| --- | --- | --- |
| `SERVICE_NAME`, `PORT`, `LOG_LEVEL` | all | Basics |
| `DATABASE_URL` | services | Connection as `svc_<name>`; never `postgres` or `app_admin` |
| `AMQP_URL` | services | RabbitMQ |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | all | Jaeger OTLP endpoint |
| `JWT_PRIVATE_KEY` (Ed25519, PKCS#8 PEM, `\n`-escaped), `JWT_KEY_ID`, `JWT_ISSUER`, `JWT_AUDIENCE`, `ACCESS_TTL_S`, `REFRESH_TTL_S`, `COOKIE_SECURE`, `LOGIN_MAX_FAILURES`, `LOGIN_LOCK_WINDOW_S`, `TRUST_PROXY` | identity | Token signing (EdDSA), refresh cookie, lockout after repeated failed sign-ins |
| `IDENTITY_URL`, `TRANSIT_URL`, `ACCESSIBILITY_URL`, `PLACES_URL`, `REDIS_URL`, `WEB_ORIGIN` (comma-separated), `JWT_ISSUER`, `JWT_AUDIENCE`, `UPSTREAM_TIMEOUT_MS`, `ACCESSIBILITY_TIMEOUT_MS`, `BREAKER_THRESHOLD`, `BREAKER_HALF_OPEN_MS`, `RATE_LIMIT_WINDOW_S`, `BODY_LIMIT_BYTES`, `TRUST_PROXY` | gateway | Upstreams, token checks, limits store, CORS, resilience |
| `TRANSIT_URL`, `TRANSIT_TIMEOUT_MS`, `CITIES` (default `waw,vno`), `TIMETABLE_CACHE_SIZE`, `OSRM_URL_WAW`, `OSRM_URL_VNO`, `ALGO_VERSION`, `MAX_PARALLEL_CALCS`, `CAR_TIME_FACTOR`, `CAR_OVERHEAD_S`, `OSRM_TIMEOUT_MS`, `OSRM_CHUNK_SIZE`, `OSRM_PARALLEL` | accessibility | Upstreams, timetables in memory, method parameters |
| `GEOCODER_PROVIDER`, `GEOCODER_URL`, `GEOCODER_MIN_INTERVAL_MS` | places | Geocoder selection and throttling |
| `STORAGE_DRIVER` (`fs`; `s3` in phase 10), `STORAGE_PATH` or `S3_BUCKET`, `DOWNLOAD_TIMEOUT_MS`, `MAX_DOWNLOAD_BYTES`, `IMPORT_STATEMENT_TIMEOUT_MS`, `MAX_STOPS_OUTSIDE_SHARE` | transit-data | Raw GTFS and artifacts, import limits |

## Platform package (`packages/common`, `@heatmap/common`)

| Module | Provides |
| --- | --- |
| `config` | `loadConfig(schema)` with zod; `baseConfigSchema` (`SERVICE_NAME`, `PORT`, `HOST`, `LOG_LEVEL`, `SHUTDOWN_TIMEOUT_MS`, `OTEL_EXPORTER_OTLP_ENDPOINT`), `databaseConfigSchema` (`DATABASE_URL`, `DB_POOL_MAX`, `DB_STATEMENT_TIMEOUT_MS`); all problems reported at once, values never echoed |
| `context` | `AsyncLocalStorage` with correlation id and caller; `runWithContext`, `currentCorrelationId` |
| `logger` | pino JSON with `time`, `level`, `service`, `msg`, `correlation_id`, `trace_id`, `span_id`; redaction by key |
| `tracing`, `otel-register` | OpenTelemetry SDK (HTTP, fetch, pg), OTLP export, `withSpan`, trace headers for messages |
| `server` | `createServer` (correlation id, context, request log, problem+json, health, readiness checks, 503 while draining) and `runServer` (SIGTERM/SIGINT shutdown with timeout) |
| `errors` | `ValidationError` 400, `UnauthorizedError` 401, `ForbiddenError` 403, `NotFoundError` 404, `ConflictError` 409, `UnprocessableError` 422, `TooManyRequestsError` 429, `ServiceUnavailableError` 503, `UpstreamError` 502 |
| `db` | `createPool` (statement timeout), `assertServiceRole` (refuses superuser, `app_admin` and its members, CREATEROLE/CREATEDB/BYPASSRLS), `createKysely`, `withTransaction` (sets `app.correlation_id`), `pingDatabase` |
| `messaging` | `Broker` (connection with automatic recovery, declares the topology from `@heatmap/contracts`), `OutboxPublisher` (confirms, retention, delete-after-publish for events with a user id), `EventConsumer` (envelope validation, inbox, correlation and trace restore, retries with backoff, dead-lettering) |
| `http-client` | `HttpClient`: per-attempt timeout, retry with backoff and jitter for GET/HEAD, circuit breaker, correlation id header |

`packages/common/examples/sample-service.ts` is a minimal service built from it.

`packages/testing` (`@heatmap/testing`) starts PostGIS with the real bootstrap, role passwords,
the service's migrations and reference data, and RabbitMQ; integration tests connect as the
service's own `svc_*` role.

New services start from `templates/service` (`pnpm new:service <name> --schema <schema> --port <port>`):
`app.ts` assembles the service (also used by integration tests through `app.inject()`), `main.ts`
only starts it; config
with database and broker, `assertServiceRole`, broker with outbox publisher and consumer,
readiness checks for database and broker, shutdown order (consumer, outbox, broker, pool).

## Images

One Dockerfile for every Node service: `infra/docker/service.Dockerfile`, build argument
`SERVICE` (e.g. `services/identity`). Stage 1 installs production dependencies of that service
and its workspace packages only (`pnpm install --prod --filter "{./$SERVICE}..."`); stage 2 copies
them with the sources, runs as user `node` with root-owned read-only files, and checks
`/health/ready`. There is no build step: Node strips the types at run time, so the workspace
layout is kept (Node does not strip types under `node_modules`).

## Observability

- **Logs:** pino JSON to stdout. Base fields `service`, `correlation_id`, `trace_id`. Request
  log on completion with method, route, status, duration. Redaction list for `authorization`,
  `cookie`, `password`, `email`, `addressText`.
- **Correlation:** gateway creates the id; `packages/common` propagates it through
  `AsyncLocalStorage`, the HTTP client and the message publisher/consumer.
- **Tracing:** OpenTelemetry started before any other import
  (`node --import @heatmap/common/otel src/main.ts`; no-op without `OTEL_EXPORTER_OTLP_ENDPOINT`). One trace
  covers browser request -> gateway -> service -> PostgreSQL / OSRM / RabbitMQ -> consumer.
  Manual spans: `raptor.query`, `osrm.table.batch`, `gtfs.copy`, `gtfs.promote`.
- **Health:** liveness and readiness endpoints; Compose healthchecks use readiness.
- **Evidence for the defence:** a Jaeger screenshot of one calculation trace and a log excerpt
  filtered by one `correlation_id` across three services go into `docs/evidence/`.

## Tests

| Level | Tool | Scope |
| --- | --- | --- |
| Unit | Vitest | RAPTOR, walking model, GTFS parsing, validation, policies |
| Database | `db/tests/smoke.sql` | Constraints, triggers, procedures, masking, privileges |
| Integration | Vitest + Testcontainers (PostGIS, RabbitMQ) | Repositories, outbox/inbox, import of `testville`, endpoints of one service |
| Contract | OpenAPI response validation in integration tests; AsyncAPI schema validation of published events | Code matches contracts |
| End to end | Playwright against the `full` profile with `testville` and a stub OSRM | Register, geocode, map, save place, history, delete account |
| Load | k6 | p95 of `POST /calculations` for Warsaw, cached and uncached |

## CI (GitHub Actions)

On pull request: install, lint, typecheck, unit tests, contracts lint, database job (bootstrap,
migrate up/down/up, seeds, smoke test, data dictionary diff), integration tests, image builds.
On main: the same plus push images tagged with the commit SHA. On tag: deploy.

## Deployment (phase 10)

- One EC2 instance, Docker Compose with the production override (no published internal ports,
  restart policies, resource limits, Caddy for TLS and static files).
- Secrets from AWS SSM Parameter Store into the environment at deploy time.
- S3 bucket for raw GTFS, artifacts and nightly `pg_dump` backups; restore procedure documented
  and tried once.
- Deploy job: SSH, pull images by SHA, run `db-migrate`, `docker compose up -d`, wait for
  gateway readiness, roll back to the previous SHA on failure.
- OSRM data is built on the instance or downloaded from S3; the Mazowieckie and Lithuania
  extracts fit a small instance, check memory before choosing the type.
