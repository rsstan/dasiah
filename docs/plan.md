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

- [x] 6.1 RAPTOR as a pure library with unit tests from the testville expectations.
- [x] 6.2 Timetable loader: start-up load, event consumer, atomic swap, snapshot rows, readiness.
- [x] 6.3 OSRM client (chunking, parallelism, policies) and `infra/osrm/build.sh`; stub OSRM for tests.
- [x] 6.4 `POST /calculations`, status and results endpoints, cache and single flight, bulkhead, purge timer, legend endpoint, outbox event.
- [ ] 6.5 Measure Warsaw: p95 uncached and cached; write the numbers to `docs/evidence/performance.md`. If the target is missed, profile before changing the design.
      Done when: the API matches the OpenAPI file in contract tests, parallel identical requests compute once, and results for testville equal the hand-computed table.
      6.5 postponed (2026-11-15) until the Warsaw feed is imported; RAPTOR alone: p95 1.4 ms per query on the Vilnius timetable.

## Phase 7 — places service

- [x] 7.1 Geocoder interface with a Photon/Nominatim implementation, throttling, cache, city bounding box filter.
- [x] 7.2 Saved places CRUD with ownership checks and the 20-place rule surfaced as a 409.
- [x] 7.3 Consumers: history from `accessibility.calculation.completed.v1`, erasure from `identity.user.deleted.v1`.
      Done when: deleting an account in identity removes the user's places and history within seconds in the end-to-end test.

## Phase 8 — web frontend

- [x] 8.1 Map page: city switch, address search, heatmap layer, legend, cell popup, zoom aggregation, loading and error states, OSM attribution.
- [x] 8.2 Accounts: register, sign in, saved places, history, delete account.
- [x] 8.3 Admin page: feed versions, import, activate.
- [x] 8.4 Responsive layout for phones.

## Phase 8A — Front-end architecture (task "Front-End")

Brings `apps/web` up to the front-end grading requirements (`docs/07-requirements-matrix.md#front-end-minimum`).
Decisions (2026-11-23): own component kit instead of a UI library; for the maximum, direction 1
(advanced architecture: feature modules, lazy routes) and direction 3 (performance) in full,
direction 4 (advanced UI/UX) as a reserve. Libraries: React Router, TanStack Query, Zustand,
Testing Library.

- [x] 8A.1 Routing and pages: React Router with `/` (map), `/places`, `/history`, `/account`, `/admin` (admin only), `/sign-in`, not-found page; `App.tsx` split into `pages/` and a layout component (`AppShell`); shared map links (`?city=&lat=&lon=`) keep working.
      Done when: every route renders by its URL and through the navigation, browser back/forward work, an unknown URL shows the 404 page, `/admin` as a non-admin shows the 403 page; e2e suite green.
- [x] 8A.1b Home page and city routes (concept change, 2026-11-23): `/` is a home page with the site menu and the cities of this instance as floating buttons in the centre (search to filter them; any number of cities, built from `GET /cities`, none hard-coded); every city has its route `/cities/:code` with the map workspace (start address, departure, status, legend, map); the city switch in the side panel is replaced by a link back to all cities. Places and history stay common pages with a city filter; "show on map" opens `/cities/<code>?lat=..&lon=..`. Two layouts: the site layout (menu + content: home, sign-in, places, history, account, admin, 404) and the city layout (panel + map). Old links `/?city=..&lat=..` redirect to the city route.
      Done when: the home page lists every city from the API and filters them by name; `/cities/<code>` opens that city, an unknown code shows a not-found message; places and history filter by city and open the city route; e2e suite green.
      Found here and fixed in identity (2026-11-23): reloading a page while it refreshed the access token presented the just-rotated refresh token again and reuse detection revoked every session of the user. Now the previous token is accepted once within `REFRESH_REUSE_GRACE_S` (30 s) while its successor is unused.
- [x] 8A.2 Structure and state: folders `app/` (router, providers), `pages/`, `features/` (map, places, history, auth, admin), `shared/ui`, `shared/api`, `models/`, `styles/`; server data (cities, legend, places, history, admin) through TanStack Query; client global state (session, theme, notifications) in Zustand stores, keeping one-at-a-time token refresh (Web Lock).
      Done when: no component calls `fetch` or the API client directly except through `shared/api` and query hooks; the session tests still pass; lint rule or test guards the layer boundaries.
- [ ] 8A.3 Own component kit in `shared/ui`: Button, TextField, Select, Checkbox, Card, Badge, Tabs, Table, Skeleton, Toast, Dialog, with CSS per component and design tokens (colours, spacing, radii, typography) as CSS variables; existing screens rebuilt from it.
      Done when: screens use kit components instead of repeated markup; no inline styles except the documented ones (legend swatch colour from the API, map cursor through MapLibre).
- [ ] 8A.4 Error handling and loading: error boundary for the app and per route; toast notifications; explicit handling of 401 (sign in again), 403 (forbidden page), 404 (not-found page or message), 5xx (toast with the reference id); skeletons for every async load; central logger (console, with correlation id, level by environment).
      Done when: a thrown render error shows the fallback instead of a blank page; each of 401/403/404/500 has a test; no async view without a loading state.
- [ ] 8A.5 Forms and lists: field-level validation with messages (sign-in and registration, save and rename place, profile, feed import); sorting and filtering of saved places (name, date, city) and sorting of feed versions.
      Done when: invalid input shows a message at the field and is not sent; sort and filter state survive navigation.
- [ ] 8A.6 Component tests: Vitest + Testing Library (jsdom) for the auth form (validation, server error), the places list (sort, filter, delete), the error boundary, the router guards (404, admin-only); one e2e scenario for navigation between routes.
      Done when: at least 4 component test files pass in CI next to the existing unit and e2e tests.
- [ ] 8A.7 Documentation `specs/frontend.md`: architecture diagram (modules, components, routes, state), approach (component-based, feature modules, server state vs client state), API used by the client (schemas, methods, request/response examples, from the contracts), user flows / navigation diagram, tech stack justification (React, Vite, React Router, TanStack Query, Zustand, own kit, MapLibre), justified exceptions (inline styles).
      Done when: every required documentation section exists and links to the code; the requirements matrix front-end rows point to it.
- [ ] 8A.8 Direction 1, advanced architecture: feature modules with public entry points (`features/*/index.ts`) and no cross-feature imports except through them; lazy-loaded routes (`React.lazy` + `Suspense` with skeletons).
      Done when: an ESLint import rule enforces the module boundaries; the production build has one chunk per lazy route.
- [ ] 8A.9 Direction 3, performance: code splitting (map engine, admin and account loaded on demand), hexagon polygons and zoom merging in a Web Worker, memoisation of expensive components and selectors, bundle analysis report, Lighthouse >= 90 on desktop and mobile.
      Done when: the initial JavaScript of the sign-in and places routes does not include MapLibre; the map stays responsive while 5 000 cells are prepared; bundle report and Lighthouse results (desktop and mobile) are in `docs/evidence/frontend-performance.md`.
- [ ] 8A.10 Reserve, direction 4 (only if time allows): dark/light theme (tokens and basemap), accessibility (keyboard navigation in suggestions and lists, focus management on route change, contrast check, axe check in Playwright), a chart of the class distribution of the current map.

## Phase 9 — Hardening and evidence

- [x] 9.1 Compose profile `full`; Playwright end-to-end suite.
      Known flaky (to look at later): `services/accessibility/src/timetables/loader.itest.ts` "switches to a newly activated feed atomically" failed once in about ten runs (2026-11-15).
      Known issue (to fix before running more than one accessibility instance): on start-up `failInterrupted` marks every `running` calculation failed, including those of another live instance, whose result then fails with "already failed" (500). Found 2026-11-15.
- [ ] 9.2 Failure drills, each with a short note in `docs/evidence/resilience.md`: OSRM stopped (breaker opens, cached maps still served), RabbitMQ stopped (outbox drains after restart), geocoder timeout (cache fallback), poison message (DLQ).
- [ ] 9.3 Trace screenshot and cross-service log excerpt for one calculation in `docs/evidence/`.
- [ ] 9.4 k6 load test; rate-limit demonstration.
- [ ] 9.5 Security pass: dependency audit, headers, secrets scan, no personal data in logs.

## Phase 10 — Cloud deployment

Meanwhile a provider-agnostic single-VPS deployment exists (`infra/terraform/vps`, Compose profile
`full` behind Caddy); the AWS steps below remain the target.

- [ ] 10.1 Production Compose override, Caddy, image publishing in CI.
- [ ] 10.2 EC2, S3, parameters; deploy job with migration step and health-gated rollback.
- [ ] 10.3 Backup job and one tested restore.
- [ ] 10.4 Final pass over `docs/07-requirements-matrix.md`: every row `ready` with a link to evidence.
