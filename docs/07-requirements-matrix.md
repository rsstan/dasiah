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
| Documentation: architecture diagram, approach, API for the client, user flows, stack justification | `specs/frontend.md`: layer diagram, approach, routes, state, navigation diagram and main flows, API table with request/response examples, errors, forms, kit and CSS, tests, stack with alternatives | Document; diagrams rendered with mermaid-cli | ready |
| Components / pages / services separation, clear folders | `apps/web/src`: `app/` (router, layouts, providers, guards), `pages/`, `features/<feature>/` (components + `api` hooks), `shared/api` (fetch wrapper, query client), `shared/lib`, `models/`, `styles/` | Folder structure; ESLint rules: layers and public entries (`web/boundaries`), only `shared/api` and `features/*/api` may call the server | ready |
| Routing, 3–4 routes or more | React Router (`apps/web/src/app/router.tsx`): home `/` with the cities, one route per city `/cities/:code` (built from the API), `/sign-in`, `/places`, `/history`, `/account`, `/admin`, 404; two layouts (site, city); guards for signed-in and admin pages | `tests/e2e/src/routes.spec.ts`: cities on the home page and their routes, unknown city, old links, 404, sign-in and return, back/forward, 403 on `/admin` | ready |
| Local + global state | Local: React state in components; global server state: TanStack Query (cities, legend, places, history, admin, geocoding; one cache, retries, loading/error states); global client state: Zustand (session, toasts); URL state for view settings (see `specs/frontend.md#state-management`) | `queryClient.test.ts`, `session.test.ts`; browser check: places shared between city page and places page | ready |
| Real API, typed data, centralised requests, errors and loading | Gateway API; types generated from OpenAPI (`@heatmap/contracts`); `shared/api/client.ts`; endpoint table in `specs/frontend.md#api-used-by-the-client` | `run.test.ts`, `session.test.ts` | ready |
| Bundler, component-based UI | Vite; components per feature | Build | ready |
| Reusable and layout components, own UI kit | Layouts `app/SiteLayout.tsx`, `app/CityLayout.tsx`; kit `apps/web/src/shared/ui`: Button/ButtonLink, TextField, Select, Checkbox, Card, Badge, Tabs, Table, Skeleton, Toast, Dialog, each with its CSS; design tokens in `styles/tokens.css` | Every screen built from the kit; dialogs replace `window.confirm` | ready |
| Forms with validation, lists/tables, filter/search/sort | Controlled forms (sign-in/registration, save and rename place, profile, feed import) with field rules (`shared/lib/validation.ts`, per-form rules next to each form) and messages at the field (`aria-invalid`), server field errors (400 `errors[].path`, 409 duplicate name) mapped to the field; lists and tables (places, history, versions, coverage); search (address, cities), filters (city, status, source), sorting (places: newest/name/city; versions: newest/oldest/status) kept in the URL and remembered for the tab | `validation.test.ts`, `sort.test.ts`; browser check: invalid sign-in is not sent; sort survives the menu and a reload | ready |
| Responsive layout | `styles/index.css` phone layout (below 768 px) | e2e at 390 px (8.4) | ready |
| ESLint + Prettier, basic logging | Root ESLint (react-hooks rules, layer rule) and Prettier; central logger `shared/lib/logger.ts` (levels, correlation id of failed requests, latest entries kept) | CI lint job; `logger.test.ts` | ready |
| Global error handler, toasts, 401/403/404/500, skeletons | Error boundaries: `AppErrorBoundary` (whole app) and `RouteError` (router errorElement per layout); toasts: Zustand store + `Toaster` (live region); policy `shared/api/errorPolicy.ts`: no connection and 5xx with reference, 403, 429 as toasts, 400/404/409/422 at the form or view, 401 through the session (refresh, then "sign in again"); 404 and 403 pages; skeletons for every load | `ErrorBoundary.test.tsx` (render error shows the fallback), `errorPolicy.test.ts`, `providers.test.ts` (401), e2e routes (404, 403); browser check with places stopped (503 toast with reference) | ready |
| Unit tests (3+), e2e (1–2) | Vitest services and logic (API client, session, calculation, hexagons, URL state, validation, sorting, error policy, logger); component tests with Testing Library in jsdom: sign-in/registration form, saved places list (sort, filter, delete dialog, rename conflict), route guards (session check, sign-in with return, 403, 404), home page, error boundaries; Playwright e2e: map, account, admin, routes and navigation | CI unit and e2e jobs | ready |
| No unjustified inline styles, no tokens in code, no `any` | Two inline styles (legend colour from the API, map cursor via MapLibre); access token only in memory | Lint (`no-explicit-any`) | ready; justified in `specs/frontend.md#components-and-styles` |

## Front-End: maximum

| Requirement | Where | Evidence | Status |
| --- | --- | --- | --- |
| Direction 1: feature modules, lazy routes | `features/<name>/index.ts` public entries; local ESLint rule `apps/web/eslint/boundaries.js` (layers app -> pages -> features -> shared -> models, no page-to-page imports, features only through their entry); `React.lazy` + `Suspense` skeletons for every page except home and 404 (`app/router.tsx`); MapLibre behind a lazy `MapView` | `apps/web/test/boundaries.test.ts` (rule cases); `pnpm lint`; build: one chunk per lazy page plus `MapView`, no MapLibre in the start chunks (`specs/frontend.md#modules-and-loading`); e2e on the production build | ready |
| Direction 3: code splitting, Web Worker, memoisation, bundle analysis, Lighthouse >= 90 | Lazy pages and lazy `MapView` (MapLibre), h3-js out of the start chunk; hexagons in `features/map/hexagons.worker.ts` via `useHexagons` (cache per resolution, stale answers dropped, fallback); `memo` for `MapView`/`Legend`, stable map callback; `pnpm web:analyze` (rollup-plugin-visualizer); `scripts/lighthouse.sh`; home page animation without backdrop blur | `docs/evidence/frontend-performance.md`: chunk table and treemap (`docs/evidence/frontend-bundle.html`), start JS 187 -> 123 kB gzip; `tests/e2e/src/performance.spec.ts` (with the worker no H3 code on the main thread; median blocking time with 5 333 cells and 4x slower CPU 380 -> 161 ms; no MapLibre requested by `/sign-in` and `/places`); `useHexagons.test.tsx`; Lighthouse: home and sign-in 99–100 desktop and mobile, map 99 desktop | ready; map page on mobile 68, accepted as a justified exception (decision 2026-11-24) |
| Direction 4 (reserve): theme, accessibility, data visualisation | Light/dark theme from tokens (`styles/tokens.css`, `shared/lib/theme.ts`, menu button, early script in `index.html`), basemap per theme with the cells carried over; skip link, combobox address search, one `<h1>` per page with focus after navigation and document titles (`shared/ui/PageTitle.tsx`, `app/router.tsx`), muted text contrast raised; class distribution chart (`features/map/ClassChart.tsx`) | `tests/e2e/src/accessibility.spec.ts`: axe WCAG 2.1 A/AA + best practices on 8 pages in both themes, keyboard-only flow; `AddressSearch.view.test.tsx`, `PageTitle.test.tsx`, `theme.test.ts`, `classes.test.ts`; `specs/frontend.md#theme-accessibility-chart` | ready |

## Auto Tests

| Requirement | Where | Evidence | Status |
| --- | --- | --- | --- |
| Coverage of at least 70 %, with report | `pnpm test:cov`, `vitest.config.ts` | `docs/evidence/tests.md`: back end 91.6 / 80.5 / 91.9 %, everything 79.0 / 70.4 / 73.3 % (lines, branches, functions) | ready |
| Unit tests, FIRST, edge cases | `*.test.ts` next to the code | `pnpm test` | ready |
| Integration tests (endpoints, database, authorization, configuration) | `*.itest.ts` with Testcontainers | `pnpm test:int` | ready |
| UI tests | Component tests and Playwright (`tests/e2e`) | 16 e2e tests, 5 of 5 runs | ready |
| CI on clean infrastructure | `.github/workflows/ci.yml` | Run link in `docs/evidence/tests.md` | ready; link after the next push |
| Strategy, instructions, known gaps | `specs/testing.md` | Document | ready |
| Names and structure | `specs/testing.md#names-and-directories` | Files | ready |
| Multi-service, migrations, asynchronous flows, queues | `tests/cross-service` (map flow, erasure, migrations), `messaging.itest.ts` | Integration job | ready |
| Property-based, mutation, contract tests | `*.property.test.ts`, `stryker.config.json`, `contractChecker` | Mutation score 89.7 % | ready |
| Quality gates | Coverage and mutation thresholds, lint, types, no flaky passes | `specs/testing.md#ci-and-quality-gates` | ready |
| Rationale, defects found, recommendations | `specs/testing.md` | Document | ready |
| Load tests | `tests/load`, `scripts/load.sh` | `docs/evidence/load.md` | ready |
