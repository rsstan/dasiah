# 7. Requirements matrix

Each grading requirement, where it is satisfied, and what to show as evidence. Status:
`ready` = present in the repository now, `spec` = specified, built in the named phase of
`docs/plan.md`. Update the status when a phase is finished.

## Database: minimum

| Requirement | Where | Evidence | Status |
| --- | --- | --- | --- |
| Data dictionary: layers, tables, columns, types, keys, quality expectations | `docs/db/data-dictionary.md`, `docs/03-database.md#data-layers` | Generated file; every table, column and routine has a description (`0002_column_comments.sql`) | ready |
| How integrity is maintained, how transactions are handled | `docs/03-database.md#integrity-and-transactions` | Section + smoke test output | ready |
| Logical schema, clear, colour-coded | `docs/03-database.md#logical-schema`, ER per schema with attributes and keys in the dictionary | `docs/db/img/*.svg`, `*.png` (`pnpm db:diagrams`), colour per schema | ready |
| DDL script | `db/bootstrap/`, `services/*/migrations/` | Files in Git | ready |
| Modern relational DBMS | PostgreSQL 16 + PostGIS | Compose file | ready / P0 |
| 3NF | `docs/03-database.md#normalisation-3nf` | Section | ready |
| Enough tables, different relationship types | 32 tables in 4 schemas plus 7 staging tables; 1:N, M:N, self-reference, composite | Dictionary | ready |
| PK, FK, constraints, meaningful types | Migrations | Dictionary "Constraints" lists | ready |
| Structure created by script or migrations, in Git | node-pg-migrate + SQL | CI database job | ready, wiring in P0–P1 |
| Enough test data, edge cases | `fixtures/gtfs/testville` (edge cases listed in its README), `db/seed/test/seed.ts` | `pnpm db:seed:test` output: every legend class, expired rows, 20-place user, anonymised user | ready |
| Scripts for reference tables | `db/seed/reference/*.sql` | Files | ready |
| Roles `app_read`, `app_write`, admin or better | Bootstrap; `docs/03-database.md#roles-and-access` | Privileges table in the dictionary; smoke test "rejected" lines | ready |
| Application not under superuser | `svc_*` roles, `DATABASE_URL` rule, `assertServiceRole` in `packages/common/src/db.ts` | Start-up refuses superuser, `app_admin` and its members (`db.itest.ts`; sample service log "Refusing to start") | ready |
| Permissions updated for new objects | Default privileges + `db-change` skill + dictionary diff in CI | PR showing privileges diff | ready |
| Passwords encrypted, no MD5/SHA-1 | Argon2id (node:crypto, OWASP parameters) in `services/identity/src/domain/password.ts`; `users_password_algo` check; refresh tokens stored as SHA-256 | Smoke test "non-argon2id hash rejected"; `identity.itest.ts` "no response or log line contains a password, a password hash or a refresh token" | ready |
| Integrity through constraints and transactions | Migrations, procedures | Smoke test | ready |
| No plain-text passwords, no CSV-only storage, no unmodelled JSON, no ignored integrity | Design; JSON only in `outbox.payload`, justified | `docs/03-database.md#normalisation-3nf` | ready |

## Database: maximum

| Requirement | Where | Evidence | Status |
| --- | --- | --- | --- |
| Several DBMS types if justified | Not used for primary data: data is relational and spatial, volumes are small; Redis holds only rate-limit counters. Reasoning in the thesis text | `docs/02-architecture.md#decisions` D1 | ready (justified absence) |
| Data layers raw -> staging -> mart, with reasoning | GTFS import (`services/transit-data/src/import/`): zip in storage -> `transit_staging` by COPY -> `promote_feed` -> `hex_stop_access`, timetable artifacts | `docs/03-database.md#data-layers`; `transit-data.itest.ts` (testville row counts, no-op re-import, failed feed leaves core empty) | ready |
| Versioning of the structure | Migrations, `pgmigrations` tables, Git, CI up/down/up | `docs/03-database.md#versioning-of-the-structure` | ready |
| Indexes, justified | Migrations | `docs/03-database.md#indexes`, `docs/db/query-plans.md` (`pnpm db:plans`) | ready |
| Triggers, procedures, functions with business logic | Feed and calculation status machines, audit, limits, `promote_feed`, `activate_feed`, `anonymize_user`, `purge_expired` | Dictionary "Routines" and "Triggers"; smoke test | ready |
| Views, materialized views | 7 views, `mv_city_coverage` | Dictionary "Views" | ready |
| Masking / anonymisation of personal data | Masked views, privilege split, `anonymize_user`, `erase_user`, origin as H3 cell | Smoke test; query as `reporting`; `erasure.itest.ts`: deleting an account removes places and history in places within seconds | ready |

## Microservices

| Requirement | Where | Evidence | Status |
| --- | --- | --- | --- |
| At least 3 business services | identity, transit-data, accessibility, places | `docs/02-architecture.md#services`; `services/identity`, `services/transit-data`, `services/accessibility`, `services/places`; `tests/cross-service/src/erasure.itest.ts` (identity and places together) | ready |
| Architecture diagram | `docs/02-architecture.md#container-diagram` | Diagram | ready |
| Reasoning for the decomposition | `docs/02-architecture.md#why-this-split` | Section | ready |
| Contracts (OpenAPI / AsyncAPI) | `contracts/openapi/*.yaml` (OpenAPI 3.1, gateway generated), `contracts/asyncapi/heatmap-events.yaml` (AsyncAPI 3); overview in `docs/04-contracts.md` | CI job `contracts` (Redocly lint, generated code up to date), `packages/contracts` tests | ready (implementations follow in P3–P7) |
| Deployment diagram | `docs/02-architecture.md#deployment` | Diagram | ready |
| Own database or schema per service | Schema + role per service, no cross-schema access | Smoke test "svc_transit reads identity: rejected" | ready |
| Health endpoints | `/health/live`, `/health/ready` from the server factory (`packages/common/src/server.ts`) | `server.test.ts`; every container of the Compose profile `full` has a health check and starts only on healthy dependencies (`infra/compose/docker-compose.yml`); e2e job in CI | ready |
| Logs with correlation ID | `packages/common` logger, request context, HTTP client header | `logger.test.ts`, `server.test.ts`; log excerpt across services in `docs/evidence/` (P9) | ready (platform), evidence P9 |
| Gateway: routing, authorization, rate limiting | `apps/gateway`; route table generated from the contracts | `gateway.itest.ts`: 401 without token, 403 user on admin route, 429 with `Retry-After`, spoofed `X-User-Id` ignored, 503 when a service is down, breaker opens | ready |
| Message broker | RabbitMQ, three events, outbox/inbox (`packages/common/src/messaging`) | AsyncAPI; `messaging.itest.ts` (at-least-once, duplicate skipped, poison and failing messages in the DLQ); RabbitMQ UI screenshot in P9 | ready; all three events produced and consumed (`places.itest.ts`, `erasure.itest.ts`) |
| Resilience patterns | Timeout, retry, breaker, bulkhead, fallback, outbox, idempotent consumer, DLQ, single flight | `docs/02-architecture.md#resilience-patterns`; tests: `http-client.test.ts`, `messaging.itest.ts`, `gateway.itest.ts`, `osrm.test.ts`, `loader.itest.ts` (previous timetable kept), `calculations.itest.ts` (OSRM down -> 503 and cached maps served, bulkhead 503, identical requests computed once), `places.itest.ts` (geocoder down -> expired cache entry served, 503 without one); drills with the running stack in P9 | ready (tests), drills P9 |
| Tracing | OpenTelemetry + Jaeger (`packages/common/src/tracing.ts`) | Sample-service trace: server span, pg spans, outgoing fetch, nested inbound span; screenshot in P9 | ready (platform), evidence P9 |

## Front-End: minimum

Plan: phase 8A in `docs/plan.md`. Status as of 2026-11-23.

| Requirement | Where | Evidence | Status |
| --- | --- | --- | --- |
| SPA on a modern framework | React 19 + Vite, `apps/web` | Build in CI (`pnpm web:build`) | ready |
| Documentation: architecture diagram, approach, API for the client, user flows, stack justification | `specs/frontend.md` | Document | spec (8A.7) |
| Components / pages / services separation, clear folders | `apps/web/src`: `app/` (router, layout, map state, guards), `pages/`, components and services per feature | Folder structure | partial: pages and layout ready; layers spec (8A.2) |
| Routing, 3–4 routes or more | React Router: `/`, `/sign-in`, `/places`, `/history`, `/account`, `/admin`, 404 (`apps/web/src/app/router.tsx`); guards for signed-in and admin pages | `tests/e2e/src/routes.spec.ts`: 404, sign-in and return, navigation, back/forward, 403 on `/admin` | ready |
| Local + global state | React state; session store; TanStack Query and Zustand planned | Code, `specs/frontend.md` | partial; spec (8A.2) |
| Real API, typed data, centralised requests, errors and loading | Gateway API; types generated from OpenAPI (`@heatmap/contracts`); `src/api/client.ts` | `run.test.ts`, `session.test.ts` | ready |
| Bundler, component-based UI | Vite; components per feature | Build | ready |
| Reusable and layout components, own UI kit | `shared/ui` | Screens built from the kit | spec (8A.1, 8A.3) |
| Forms with validation, lists/tables, filter/search/sort | Auth, place, profile, import forms; places, history, versions lists; address search, version filters | e2e account and admin tests | partial: field validation and sorting spec (8A.5) |
| Responsive layout | `styles.css` phone layout | e2e at 390 px (8.4) | ready |
| ESLint + Prettier, basic logging | Root ESLint (react-hooks rules) and Prettier; central logger | CI lint job | partial: logger spec (8A.4) |
| Global error handler, toasts, 401/403/404/500, skeletons | Error boundary, toast store, status pages | Tests | spec (8A.4) |
| Unit tests (3+), e2e (1–2) | Vitest: client, session, calculation, hexagons, URL state; Playwright: map, account, admin | CI unit and e2e jobs | ready; component tests spec (8A.6) |
| No unjustified inline styles, no tokens in code, no `any` | Two inline styles (legend colour from the API, map cursor via MapLibre); access token only in memory | Lint (`no-explicit-any`) | ready; justification in docs (8A.7) |

## Front-End: maximum

| Requirement | Where | Evidence | Status |
| --- | --- | --- | --- |
| Direction 1: feature modules, lazy routes | `features/*` with public entry points, `React.lazy` routes | ESLint boundary rule, build chunks | spec (8A.8) |
| Direction 3: code splitting, Web Worker, memoisation, bundle analysis, Lighthouse >= 90 | Lazy map engine, hexagon worker | `docs/evidence/frontend-performance.md` | spec (8A.9) |
| Direction 4 (reserve): theme, accessibility, data visualisation | Tokens, keyboard navigation, axe in Playwright, class distribution chart | Tests, screenshots | optional (8A.10) |
