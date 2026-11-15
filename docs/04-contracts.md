# 4. Contracts

The machine-readable contracts are the source of truth; this file is the overview.

| File | Content |
| --- | --- |
| `contracts/openapi/identity.yaml`, `transit-data.yaml`, `accessibility.yaml`, `places.yaml` | OpenAPI 3.1, one per service, written by hand. Every operation has `x-access` (`public`, `user`, `admin`, `internal`) and, unless internal, `x-rate-limit` |
| `contracts/openapi/common.yaml` | Shared components: `Problem`, coordinates, headers, error responses, health |
| `contracts/openapi/gateway.yaml` | Public API, **generated** from the service files: operations that are not internal, under `/api/v1`, with security and the gateway's 401/403/429/503 |
| `contracts/asyncapi/heatmap-events.yaml` | AsyncAPI 3: exchange, events, envelopes, consumer queues (`x-queue`) |
| `redocly.yaml` | Lint rules (`pnpm contracts:lint`), incl. required `x-access`, camelCase properties, problem+json errors, `x-queue` on consumers |

`pnpm contracts:gen` (`contracts/tools/generate.ts`) writes `gateway.yaml` and
`packages/contracts/src/generated/`: TypeScript types per API, dereferenced OpenAPI JSON for
validation and contract tests, the gateway route table (`routes.json`), event types, event JSON
schemas and the RabbitMQ topology. `@heatmap/contracts` exports them together with
`validateEvent()`. CI regenerates and fails when the committed output differs.

## Common rules

- JSON, `camelCase`. Errors: `application/problem+json` with `type`, `title`, `status`,
  `detail`, `correlationId`.
- Headers: `X-Correlation-Id` (in and out), `Authorization: Bearer <access token>` (public API),
  `X-User-Id` and `X-User-Role` (gateway -> service only).
- Every service: `GET /health/live`, `GET /health/ready`.
- Lists are paginated with `limit` (default 20, max 100) and `cursor`.

## Public API (through the gateway, prefix `/api/v1`)

Access: P = public, U = signed-in user, A = admin. Limits are per minute, per user id or per IP.

| Method and path | Service | Access | Limit | Purpose |
| --- | --- | --- | --- | --- |
| POST `/auth/register` | identity | P | 5 | Create account `{email, password, displayName?}` -> 201 |
| POST `/auth/login` | identity | P | 10 | `{email, password}` -> access token (15 min) in body, refresh token in an httpOnly cookie |
| POST `/auth/refresh` | identity | P | 30 | Rotate refresh token, new access token |
| POST `/auth/logout` | identity | U | 30 | Revoke current refresh token |
| GET `/users/me` | identity | U | 60 | Profile |
| PATCH `/users/me` | identity | U | 20 | Change `displayName`, `locale` |
| POST `/users/me/password` | identity | U | 5 | Change password, revoke other sessions |
| DELETE `/users/me` | identity | U | 5 | Erase account (anonymise + event) |
| GET `/cities` | transit-data | P | 120 | Cities with bounds, timezone, active feed validity |
| GET `/cities/{code}/coverage` | transit-data | P | 60 | Numbers from `mv_city_coverage` |
| GET `/admin/feed-versions` | transit-data | A | 60 | List with status, filter by `source`, `status` |
| GET `/admin/feed-versions/{id}` | transit-data | A | 60 | One version with import status and error (poll after import) |
| POST `/admin/feed-sources/{code}/import` | transit-data | A | 6 | Download and hash, then import in the background -> 202 `{feedVersionId, status, duplicate}`; same archive again -> 200 no-op; 409 import running; 502 publisher error |
| POST `/admin/feed-versions/{id}/activate` | transit-data | A | 6 | Activate a validated version; 409 if not validated |
| GET `/geocode?city=&q=` | places | P | 30 | Up to 5 candidates `{displayName, lat, lon}` |
| GET `/places` | places | U | 60 | Saved places |
| POST `/places` | places | U | 20 | `{kind, label, addressText, cityCode, location: {lat, lon}}`; 409 at 20 places or duplicate label |
| PATCH / DELETE `/places/{id}` | places | U | 20 | Owner only; another user's place answers 404 |
| GET `/history` | places | U | 60 | Last maps of the user |
| GET `/legend` | accessibility | P | 120 | Rows of `ratio_classes` |
| POST `/calculations` | accessibility | P | anonymous 6, user 20 | Request a map (below) |
| GET `/calculations/{id}` | accessibility | P | 120 | Status and metadata |
| GET `/calculations/{id}/results` | accessibility | P | 60 | Cells; gzip; `Cache-Control: immutable`; 409 while running or failed |

### POST `/calculations`

Request:

```json
{ "cityCode": "waw", "origin": { "lat": 52.2297, "lon": 21.0122 },
  "date": "2026-12-02", "time": "08:00", "windowMinutes": 0 }
```

`date` and `time` are optional (default: next working day inside the feed validity, 08:00 local).

Responses:

- `201` (computed now) or `200` (cache hit): `{ "calculationId", "status": "done", "cityCode",
  "originH3", "feedVersionId", "date", "time", "windowMinutes", "cellCount", "durationMs",
  "createdAt", "expiresAt", "errorCode" }`
- `202`: the same question is being computed by another request; poll `GET /calculations/{id}`.
- `400` invalid input, `404` unknown city, `422` origin outside the city or date outside the
  feed validity, `429` rate limit, `503` no timetable loaded, calculation queue full or car
  routing unavailable (`Retry-After`).

### GET `/calculations/{id}/results`

```json
{ "calculationId": "…", "resolution": 9,
  "cells": [ { "h3": "891f53c9a43ffff", "transitS": 1320, "carS": 780, "ratio": 1.69, "class": "fair" } ] }
```

`transitS` or `carS` may be `null`; then `ratio` is `null` and `class` is `unreachable` or
`no_transit`.

## Internal API (service to service, not routed by the gateway)

| Method and path | Provider | Consumer | Purpose |
| --- | --- | --- | --- |
| GET `/.well-known/jwks.json` | identity | gateway | Public keys for token verification |
| GET `/internal/cities/{code}/active-feed` | transit-data | accessibility | `{feedVersionId, validFrom, validTo}`; used at start-up |
| GET `/internal/feed-versions/{id}/timetable?date=YYYY-MM-DD` | transit-data | accessibility | Timetable artifact for one service date (format in `05-algorithms.md`), gzip, `ETag` |
| GET `/internal/feed-versions/{id}/hex-access` | transit-data | accessibility | Cells of the city with centroid and access stops `[stopId, walkS]`, `ETag` |

## Events

Broker: RabbitMQ. One topic exchange `heatmap.events`; routing key = event type. One durable
quorum queue per consumer and event, named `<consumer>.<event>`, with delivery limit 5 and
dead-letter exchange `heatmap.dlx` (fanout) feeding `heatmap.dlq`. Queues are listed in the
AsyncAPI file (`x-queue`) and exported as `topology` by `@heatmap/contracts`.

Envelope (same for all events):

```json
{ "id": "uuid", "type": "transit.feed.activated.v1", "source": "transit-data",
  "time": "2026-11-15T12:00:00Z", "correlationId": "uuid", "data": { } }
```

AMQP properties: `messageId` = `id`, `type`, `contentType: application/json`, persistent;
headers `traceparent`, `x-correlation-id` (and `x-retry-count` on retries). The outbox row keeps
the correlation id and `traceparent` of the transaction that wrote it, so the trace continues
from the request to the consumer.

| Event | Publisher | Consumers | `data` | Effect |
| --- | --- | --- | --- | --- |
| `transit.feed.activated.v1` | transit-data | accessibility | `cityCode`, `feedVersionId`, `validFrom`, `validTo` | Load the new timetable, switch the current snapshot; old cached maps stop matching the cache key |
| `accessibility.calculation.completed.v1` | accessibility | places | `calculationId`, `cityCode`, `originH3`, `userId` (nullable), `cacheHit` | Add a history row when `userId` is present |
| `identity.user.deleted.v1` | identity | places | `userId` | `places.erase_user(userId)` |

Rules:

- Events are facts in the past tense, versioned by suffix. A breaking change is a new version
  published alongside the old one until consumers have moved.
- Delivery is at least once; consumers are idempotent by `id`.
- A failing handler is retried with backoff up to 5 attempts, then the message is dead-lettered;
  malformed messages and contract violations are dead-lettered at once
  (`packages/common/src/messaging/consumer.ts`).
- Published outbox rows are deleted after 7 days. `calculation.completed` carries a user id, so
  for that event type the outbox row is deleted right after publishing.
