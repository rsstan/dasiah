---
name: api-contract
description: Add or change an HTTP endpoint of a service or a gateway route. Use before writing any handler code.
---

# HTTP endpoint, contract first

1. Edit `contracts/openapi/<service>.yaml`: path, `operationId`, request and response schemas,
   every error status with the shared `Problem` schema, `X-Correlation-Id` header parameter.
   Public endpoint: also add it to `contracts/openapi/gateway.yaml` with its access level
   (`x-access: public|user|admin`) and rate-limit group (`x-rate-limit`).
2. `pnpm contracts:lint && pnpm contracts:gen`.
3. Implement in the service:
   - route with the generated schema for validation and serialisation;
   - handler -> use case -> repository; SQL only in repositories (Kysely);
   - read the caller from `X-User-Id` / `X-User-Role`; check ownership in the use case;
   - map domain errors to problem responses; never leak SQL or stack traces;
   - one transaction per command; if the command emits an event, insert the outbox row in it.
4. Gateway: add the route to the route table with access level and limit group. Paths under
   `/internal` are never added.
5. Tests: integration test per status code in the contract, validating responses against the
   OpenAPI schema; gateway test for 401/403/429 when the route is not public.
6. Update the table in `docs/04-contracts.md`.

Conventions: nouns in plural, no verbs in paths except explicit commands (`/import`,
`/activate`); `201` with `Location` on create; `204` on delete; `409` for business-rule
conflicts; `422` for well-formed but unacceptable input; cursor pagination.
