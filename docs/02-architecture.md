# 2. Architecture

## Services

Four business services, each with its own data and its own reason to change. Frontend, gateway,
database and broker are not counted as business services.

| Service | Business capability | Owns (schema) | Talks to |
| --- | --- | --- | --- |
| `identity` | Accounts, sign-in, tokens, account deletion | `identity` | publishes `identity.user.deleted.v1` |
| `transit-data` | Timetable lifecycle: download GTFS, validate, normalise, build the hexagon grid and access stops, activate a version | `transit`, `transit_staging` | publishes `transit.feed.activated.v1` |
| `accessibility` | The core calculation: transit times (RAPTOR), car times (OSRM), ratio per cell, calculation cache | `accessibility` | calls `transit-data` (internal API), OSRM; consumes `transit.feed.activated.v1`; publishes `accessibility.calculation.completed.v1` |
| `places` | Addresses: geocoding with cache, saved places, search history | `places` | calls a geocoder and `transit-data` (`GET /cities`); consumes `accessibility.calculation.completed.v1`, `identity.user.deleted.v1` |

Supporting components: `gateway` (single public entry point), `web` (frontend), PostgreSQL,
RabbitMQ, Redis, OSRM (one instance per city), Jaeger.

### Why this split

- **Different rates of change and load.** Timetable import is a heavy batch job that runs a few
  times a month. Calculations are CPU-bound, memory-heavy (timetable in RAM) and run on every
  user request. Accounts and saved places are small CRUD. Each can be scaled, deployed and
  restarted without the others: a failed import must not take the map down.
- **Different data ownership.** Timetable data is public and replaceable; account data is
  personal and must be erasable. Keeping them in separate schemas with separate roles means a
  bug or leak in the calculation service cannot reach emails or password hashes.
- **Clear contracts.** `accessibility` needs exactly two things from `transit-data`: a timetable
  for a date and the access stops of each cell. `places` needs nothing from `identity` except
  the user id in the token (and the `user.deleted` event), and from `transit-data` only the public
  city list with bounding boxes. Small interfaces are what makes the split cheap.
- **Rejected alternatives.** (a) A monolith with modules: simpler, but an import or a memory
  spike in routing would affect sign-in, and the grading criterion requires services. (b) A
  separate geocoding service and a separate history service: too thin, they would be CRUD
  wrappers; grouped into `places` by the business concept "address". (c) Routing split into a
  transit service and a car service: both are steps of one calculation and would need a
  distributed transaction for one result.

## Container diagram

```mermaid
flowchart LR
  user([Browser]) --> web[web<br/>React + MapLibre]
  web -->|HTTPS /api/v1| gw[gateway<br/>routing, JWT, rate limit]
  gw --> idn[identity]
  gw --> trn[transit-data]
  gw --> acc[accessibility]
  gw --> plc[places]
  gw -.rate counters.-> redis[(Redis)]
  gw -.JWKS.-> idn

  acc -->|internal REST| trn
  acc --> osrm[OSRM car<br/>one per city]
  plc --> geo[Geocoder<br/>Photon / Nominatim]
  plc -->|GET /cities| trn
  trn -->|download| gtfs[(GTFS publishers)]

  idn --- pg[(PostgreSQL<br/>schema per service)]
  trn --- pg
  acc --- pg
  plc --- pg

  idn -- user.deleted --> mq{{RabbitMQ<br/>heatmap.events}}
  trn -- feed.activated --> mq
  acc -- calculation.completed --> mq
  mq --> acc
  mq --> plc

  classDef biz fill:#dbeafe,stroke:#1d4ed8,color:#111;
  classDef infra fill:#f3f4f6,stroke:#6b7280,color:#111;
  classDef ext fill:#fef3c7,stroke:#b45309,color:#111;
  class idn,trn,acc,plc biz
  class gw,web,pg,mq,redis,osrm infra
  class geo,gtfs ext
```

## Main flow: map for an address

```mermaid
sequenceDiagram
  autonumber
  participant W as web
  participant G as gateway
  participant P as places
  participant A as accessibility
  participant O as OSRM
  participant Q as RabbitMQ
  W->>G: GET /api/v1/geocode?city=waw&q=...
  G->>P: forward (+ X-Correlation-Id)
  P-->>W: candidates {lat, lon, displayName}
  W->>G: POST /api/v1/calculations {cityCode, origin, date, time}
  G->>G: verify JWT if present, rate limit
  G->>A: forward (+ X-User-Id if signed in)
  A->>A: snap origin to H3 r10, look up cache
  alt not cached
    par transit
      A->>A: RAPTOR from access stops of the origin
    and car
      A->>O: table (origin -> cell centroids, chunked)
    end
    A->>A: store calculation + results (one transaction, + outbox row)
  end
  A-->>W: 201 {calculationId}
  W->>G: GET /api/v1/calculations/{id}/results
  A-->>W: cells [{h3, transitS, carS, ratio, class}]
  A-)Q: accessibility.calculation.completed.v1
  Q-)P: add to search history (signed-in users only)
```

## Timetable update flow

```mermaid
sequenceDiagram
  participant Adm as admin / scheduler
  participant T as transit-data
  participant Q as RabbitMQ
  participant A as accessibility
  Adm->>T: POST /admin/feeds/{source}/import
  T->>T: download zip, sha256, store raw, COPY into staging
  T->>T: CALL promote_feed, rebuild_transfers, rebuild_hex_stop_access
  Adm->>T: POST /admin/feed-versions/{id}/activate
  T->>T: CALL activate_feed (status, outbox, refresh mat. view)
  T-)Q: transit.feed.activated.v1
  Q-)A: consume
  A->>T: GET /internal/feed-versions/{id}/timetable?date=...
  A->>T: GET /internal/feed-versions/{id}/hex-access
  A->>A: build RAPTOR structures, swap atomically, mark snapshot current
```

## API gateway

A thin Fastify application: no business logic, no database.

| Concern | Behaviour |
| --- | --- |
| Routing | Public prefix `/api/v1`. The route table is generated from the contracts (`routes` of `@heatmap/contracts`: every operation with `x-access` public, user or admin); `/internal/*` paths are never routed. Bodies and compressed responses are forwarded byte for byte; hop-by-hop headers, `Authorization`, `X-User-*` and client trace headers are not. |
| Authentication | Verifies the access token (JWT, EdDSA/Ed25519, issuer and audience checked) against the JWKS of `identity`, cached with refresh on unknown `kid`. An invalid or expired token is `401` on every route; if identity cannot be reached, `503`. |
| Authorization | Per route: `public`, `user`, `admin`. On success sets `X-User-Id` and `X-User-Role` for the service; always strips these headers from incoming requests. Services trust them because only the gateway can reach services on the internal network. Services still check ownership (a user reads only own places). |
| Rate limiting | Redis-backed fixed window (Lua `INCR` + `PEXPIRE`), one counter per route and caller: user id when signed in, otherwise client IP. Limits from `x-rate-limit` in the contracts. `RateLimit-*` headers; `429` with `Retry-After`. If Redis is down requests pass and a warning is logged. |
| Correlation | Generates `X-Correlation-Id` (UUID) if the client sent none; forwards it and returns it in the response. Starts the trace. |
| Resilience | Per-upstream timeout to the response headers (accessibility longer) and circuit breaker (network errors, timeouts, 502/504 count; a deliberate 503 from a service is passed through). `503` problem with `Retry-After` when unavailable, timed out or open. |
| Other | CORS for the web origin with credentials, request size limit, security headers (`nosniff`, `DENY`, `no-referrer`, CSP `default-src 'none'`, HSTS), aggregated `/health/ready` (Redis and every service). `X-Forwarded-For` is trusted only with `TRUST_PROXY` (behind Caddy). |

## Sessions in the browser (`web`)

| Concern | Behaviour |
| --- | --- |
| Storage | The access token (15 min) lives only in memory; the refresh token is an httpOnly, `SameSite=Strict` cookie with path `/api/v1/auth`, invisible to scripts. Nothing about the session is kept in `localStorage`. |
| Restore | On page load `POST /auth/refresh`: a valid cookie signs the user in again; `401` means signed out. |
| Refresh | A minute before the access token expires, and once after a `401` on a request that carried a token (that request is then retried once). |
| No overlapping refreshes | `identity` rotates the refresh token and treats a reused one as theft (all sessions revoked), except once within 30 s of the rotation while the successor is unused, which covers a reload or a lost response during the refresh (`REFRESH_REUSE_GRACE_S`). Refreshes therefore run one at a time: a single shared promise in the tab and a Web Lock (`navigator.locks`) across tabs, so each refresh sends the cookie the previous one set. |
| Failures | A refused refresh (`401`/`403`) signs the user out; a network or `5xx` failure keeps the session and the next call tries again. Sign-out clears the token even if the server cannot be reached. |
| Account deletion | `DELETE /users/me` after an explicit confirmation; `identity` anonymises the account and `places` erases places and history on `identity.user.deleted.v1`. |

## Cross-cutting rules for every service

| Topic | Rule |
| --- | --- |
| Health | `GET /health/live` (process is up) and `GET /health/ready` (database, broker and required upstreams reachable; for `accessibility` also "a current timetable is loaded"). |
| Logs | JSON to stdout via pino. Required fields: `time`, `level`, `service`, `correlation_id`, `trace_id`, `msg`. Never log passwords, tokens, emails or full addresses. |
| Correlation ID | Read from `X-Correlation-Id`, kept in `AsyncLocalStorage`, added to every log line, outgoing HTTP call and published message (`correlationId` in the envelope). Consumers restore it before handling a message. |
| Tracing | OpenTelemetry SDK with auto-instrumentation for HTTP, `pg` and `amqplib`; W3C `traceparent` over HTTP and in message headers; OTLP export to Jaeger. Manual spans around RAPTOR, OSRM batch and GTFS import stages. |
| Errors | `application/problem+json` (RFC 9457) with `type`, `title`, `status`, `detail`, `correlationId`. |
| Config | Environment variables only, validated at start (fail fast). |
| Shutdown | On SIGTERM: stop accepting, finish in-flight requests and message handlers, close pools. |
| Database | One pool per service, role `svc_<name>`, statement timeout set, all multi-statement changes in a transaction. |

## Resilience patterns

| Pattern | Where |
| --- | --- |
| Timeout | Every outgoing HTTP call and every database statement. |
| Retry with backoff and jitter | Idempotent GETs to `transit-data`, OSRM and the geocoder; GTFS download. Never on POST without an idempotency key. |
| Circuit breaker | `accessibility` -> OSRM, `places` -> geocoder, gateway -> each service. |
| Bulkhead | `accessibility` runs at most N calculations at once (N = CPU cores); extra requests wait in a bounded queue, then get `503` with `Retry-After`. |
| Fallback | Geocoder down: answer from `geocode_cache`, even from an expired entry; `503 /problems/geocoder-unavailable` only when nothing is cached. OSRM down: calculation fails with a clear error instead of showing wrong car times; cached maps keep working. New timetable fails to load: keep serving the previous snapshot. A city whose timetable could not be loaded at start-up (for example `transit-data` was not up yet) is retried every `TIMETABLE_RETRY_MS`; readiness stays `503` until one city is loaded. |
| Transactional outbox | A state change and its event are written in one database transaction (with the request's correlation id and `traceparent`); a publisher loop sends unpublished rows with publisher confirms and marks them in the same transaction; rows that violate the contract are never sent. |
| Idempotent consumer | `processed_messages` table: message id inserted in the same transaction as the effect; duplicates are acknowledged and skipped. |
| Dead-letter queue | Malformed or contract-violating messages at once, failing handlers after 5 attempts (counted by the consumer in `x-retry-count`), crashing consumers after the quorum queue's delivery limit: all go through `heatmap.dlx` to `heatmap.dlq`; logged at error level. |
| Single flight | Unique partial index on the calculation cache key: the same question in parallel is computed once. |

Library: `cockatiel` (timeout, retry, breaker, bulkhead policies) wrapped in `packages/common`.

## Deployment

Local development and the demo run on Docker Compose. Any single VPS can run the same stack
today: [infra/terraform/vps/](../infra/terraform/vps/) connects over SSH, installs Docker,
generates the secrets, builds the images on the server and starts the profile `full` with only
80/443 open (steps in [specs/microservices.md](../specs/microservices.md#d-a-vps-with-terraform)).
Target cloud deployment (phase 10) is one AWS EC2 instance running the same images with Compose,
which fits the free-tier budget; the images are built and pushed by CI.

```mermaid
flowchart TB
  subgraph dev[Developer / GitHub]
    gh[GitHub Actions<br/>test, build, push images] --> reg[(Container registry)]
  end
  subgraph aws[AWS]
    subgraph ec2[EC2 instance, Docker Compose]
      caddy[Caddy<br/>TLS, static web] --> gw[gateway]
      gw --> s1[identity] & s2[transit-data] & s3[accessibility] & s4[places]
      s3 --> osrm1[osrm-waw] & osrm2[osrm-vno]
      pg[(PostgreSQL + PostGIS<br/>volume)]
      mq{{RabbitMQ}}
      rd[(Redis)]
      jg[Jaeger]
    end
    s3b[(S3: raw GTFS, timetable artifacts, DB backups)]
    cw[CloudWatch logs]
  end
  internet([Internet]) -->|443| caddy
  reg -->|pull| ec2
  s2 --> s3b
  ec2 --> cw
```

Only ports 80/443 are open. Everything else is on the internal Compose network. Upgrade path if
there is budget: RDS for PostgreSQL, ECS Fargate per service.

## Decisions

| # | Decision | Reason | Alternative kept in mind |
| --- | --- | --- | --- |
| D1 | One PostgreSQL instance, schema + role per service | Real isolation (privileges) at the cost of one container; separate instances add cost without adding evidence | Database per service if a service needs different tuning |
| D2 | SQL-first migrations (node-pg-migrate, `.sql` files) and Kysely instead of an ORM-managed schema | Roles, triggers, procedures, PostGIS types and masked views must be written in SQL anyway; one source of truth | Prisma with `db pull` for the client only |
| D3 | Fastify | Schema validation, pino logging and request ids are built in; close to Express in style | Express 5 |
| D4 | RabbitMQ | Topic routing, dead-lettering and per-message acknowledgements fit low-volume business events; AsyncAPI has AMQP bindings | NATS JetStream |
| D5 | RAPTOR implemented in TypeScript, timetable in typed arrays | One language across the project; city-size timetables fit in memory | Rust/Go worker if p95 target is missed |
| D6 | Synchronous calculation request with cache; events only for side effects | The user waits for the map anyway; a job queue would add polling without making it faster | Queue + worker pool if calculations exceed the request timeout |
| D7 | H3 indexes stored as text, computed in the application (h3-js) | No extra database extension to build and maintain | `h3-pg` extension |
| D8 | Walking time = straight line x 1.3 at 5 km/h | Cheap, no extra routing engine; stated in the method | OSRM foot profile for access legs |
| D9 | Geocoder behind an interface; public Photon in development with cache and throttling | No paid API; self-hosting is possible later without code changes | Self-hosted Photon or Pelias |
| D10 | Custom thin gateway on Fastify | Routing, JWT and limits are a few plugins; correlation and tracing are the same code as in services | Traefik or Kong with forward-auth |
