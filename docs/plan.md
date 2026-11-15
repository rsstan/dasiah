# Implementation plan

Work top to bottom. One step = one commit or pull request. Tick a step only when its "Done
when" holds and the `verify` skill passes. Phases 1 and 3–7 each end with a row update in
`docs/07-requirements-matrix.md`.

## Phase 0 — Repository foundation

- [x] 0.1 pnpm workspace, TypeScript strict base config, ESLint, Prettier, Vitest, `.editorconfig`, `.gitignore`, `.env.example`.
      Done when: `pnpm install && pnpm lint && pnpm typecheck && pnpm test` pass on an empty workspace.
- [x] 0.2 `infra/compose/docker-compose.yml` with profile `infra`: postgres (PostGIS), rabbitmq, redis, jaeger. Bootstrap SQL runs on first start; `scripts/db-set-passwords.sh` sets role passwords from `.env`.
      Done when: `docker compose --profile infra up -d` is healthy and `psql` as `svc_identity` connects while `SELECT 1 FROM transit.cities` is denied.
- [x] 0.3 node-pg-migrate per service (`--schema`, `--migrations-schema`, SQL files, connection as `app_admin`); root scripts `db:migrate`, `db:seed`, `db:smoke`, `db:dict`.
      Done when: on a fresh database the four scripts run in order and the smoke test prints `SMOKE TEST PASSED`.
- [x] 0.4 GitHub Actions: lint, typecheck, unit tests, database job (bootstrap, up/down/up, seeds, smoke, dictionary diff).
      Done when: the workflow is green on a pull request.

## Phase 1 — Database deliverables (task "Database")

- [x] 1.1 Migration `0002_column_comments.sql` in each service: `COMMENT ON COLUMN` for every column that has none. Regenerate the dictionary.
      Done when: the dictionary has no empty Description cell.
- [x] 1.2 `fixtures/gtfs/testville/` synthetic feed with the edge cases listed in `docs/03-database.md#test-data-phase-1`, plus a README with a hand-drawn network and expected travel times.
- [x] 1.3 `db/seed/test/`: script that loads testville through staging and the procedures, then demo users (Argon2id hashes generated at seed time), saved places, calculations covering every legend class, expired rows.
      Done when: `pnpm db:seed:test` is repeatable on a fresh database and leaves an active feed for city `waw`.
- [x] 1.4 `docs/db/query-plans.md`: `EXPLAIN (ANALYZE, BUFFERS)` for sign-in by email, nearest stops of a cell, timetable export for a date, cache lookup, history page, outbox poll. Adjust indexes if a plan shows a sequential scan on a large table.
- [x] 1.5 Export the logical schema and ER diagrams to PNG/SVG in `docs/db/img/` for the thesis text.
- [x] 1.6 Backup and restore note in `docs/db/operations.md` (`pg_dump` per schema, restore order, role recreation).

## Phase 2 — Shared platform and contracts

- [x] 2.1 Write `contracts/openapi/*.yaml` and `contracts/asyncapi/heatmap-events.yaml` from `docs/04-contracts.md`; lint job; `contracts:gen` produces types in `packages/contracts`.
- [x] 2.2 `packages/common`: config loader, logger with correlation, OpenTelemetry bootstrap, Fastify server factory (health routes, problem+json errors, request logging, graceful shutdown), database pool factory (refuses to start if the role is a superuser), resilient HTTP client.
      Done when: a sample service started from the factory answers health checks, logs a `correlation_id` taken from the header, and shows a trace in Jaeger.
- [x] 2.3 `packages/common/messaging`: publisher with outbox loop, consumer with inbox table, envelope validation, correlation and trace propagation, DLQ topology.
      Done when: an integration test proves at-least-once delivery, that a duplicate is skipped, and that a poison message lands in the DLQ.
- [x] 2.4 Service template (`service-checklist` skill) including Dockerfile (multi-stage, non-root user).

## Phase 3 — identity service

- [x] 3.1 Register, login, refresh with rotation and reuse detection, logout; Argon2id; JWKS endpoint.
- [x] 3.2 Profile read/update, password change, account deletion through `identity.anonymize_user`; outbox publishing of `identity.user.deleted.v1`.
- [x] 3.3 Login audit events (`login_succeeded`, `login_failed`) and a lockout or delay after repeated failures.
      Done when: integration tests cover the happy paths, duplicate email, wrong password, expired and reused refresh token, deletion; no response or log contains a password or hash.

## Phase 4 — gateway

- [x] 4.1 Route table, proxying, correlation id, CORS, security headers, aggregated readiness.
- [x] 4.2 JWT verification through JWKS, access levels, identity headers set and incoming ones stripped.
- [x] 4.3 Redis rate limits per route group; per-upstream timeout and circuit breaker.
      Done when: integration tests show 401 without a token on a user route, 403 for a user on an admin route, 429 after the limit with `Retry-After`, a spoofed `X-User-Id` ignored, and 503 when an upstream is down.

## Phase 5 — transit-data service

- [x] 5.1 Cities and coverage endpoints; grid generation command (h3-js) with real city boundaries.
- [x] 5.2 Import pipeline: download, hash, raw storage, COPY to staging, promote, transfers, hex access; status and errors visible through the admin API.
- [x] 5.3 Activation endpoint and `transit.feed.activated.v1`.
- [x] 5.4 Internal API: active feed, timetable artifact per date (pattern building, non-overtaking split), hex access.
- [ ] 5.5 Import of the real Warsaw and Vilnius feeds; record timings and row counts in `docs/evidence/import.md`.
      Vilnius done (2026-11-15); Warsaw later.
      Done when: testville imports in the integration test with the expected row counts; a second import of the same zip is a no-op; a corrupted feed ends as `failed` with nothing left in core tables.

## Phase 6 — accessibility service

- [ ] 6.1 RAPTOR as a pure library with unit tests from the testville expectations.
- [ ] 6.2 Timetable loader: start-up load, event consumer, atomic swap, snapshot rows, readiness.
- [ ] 6.3 OSRM client (chunking, parallelism, policies) and `infra/osrm/build.sh`; stub OSRM for tests.
- [ ] 6.4 `POST /calculations`, status and results endpoints, cache and single flight, bulkhead, purge timer, legend endpoint, outbox event.
- [ ] 6.5 Measure Warsaw: p95 uncached and cached; write the numbers to `docs/evidence/performance.md`. If the target is missed, profile before changing the design.
      Done when: the API matches the OpenAPI file in contract tests, parallel identical requests compute once, and results for testville equal the hand-computed table.

## Phase 7 — places service

- [ ] 7.1 Geocoder interface with a Photon/Nominatim implementation, throttling, cache, city bounding box filter.
- [ ] 7.2 Saved places CRUD with ownership checks and the 20-place rule surfaced as a 409.
- [ ] 7.3 Consumers: history from `accessibility.calculation.completed.v1`, erasure from `identity.user.deleted.v1`.
      Done when: deleting an account in identity removes the user's places and history within seconds in the end-to-end test.

## Phase 8 — web frontend

- [ ] 8.1 Map page: city switch, address search, heatmap layer, legend, cell popup, zoom aggregation, loading and error states, OSM attribution.
- [ ] 8.2 Accounts: register, sign in, saved places, history, delete account.
- [ ] 8.3 Admin page: feed versions, import, activate.
- [ ] 8.4 Responsive layout for phones.

## Phase 9 — Hardening and evidence

- [ ] 9.1 Compose profile `full`; Playwright end-to-end suite.
- [ ] 9.2 Failure drills, each with a short note in `docs/evidence/resilience.md`: OSRM stopped (breaker opens, cached maps still served), RabbitMQ stopped (outbox drains after restart), geocoder timeout (cache fallback), poison message (DLQ).
- [ ] 9.3 Trace screenshot and cross-service log excerpt for one calculation in `docs/evidence/`.
- [ ] 9.4 k6 load test; rate-limit demonstration.
- [ ] 9.5 Security pass: dependency audit, headers, secrets scan, no personal data in logs.

## Phase 10 — Cloud deployment

- [ ] 10.1 Production Compose override, Caddy, image publishing in CI.
- [ ] 10.2 EC2, S3, parameters; deploy job with migration step and health-gated rollback.
- [ ] 10.3 Backup job and one tested restore.
- [ ] 10.4 Final pass over `docs/07-requirements-matrix.md`: every row `ready` with a link to evidence.
