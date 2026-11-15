---
name: service-checklist
description: Create a new service or review an existing one against the platform rules (health, logging, correlation, tracing, config, database role, Docker, contracts).
---

# Service checklist

A service is complete when every line holds.

Create a service with `pnpm new:service <name> --schema <schema>` (copies `templates/service`),
then `pnpm install`. The template already satisfies most lines below; check the rest.

Structure
- [ ] `services/<name>/src/{main.ts, app.ts, config.ts, context.ts, http/, usecases/, repositories/, consumers/}`;
      `app.ts` builds the service, `main.ts` only runs it
- [ ] Routes use `routeSchema(openApiDocuments.<name>, method, path)` from the contract
- [ ] Built from the `packages/common` server factory; no copy of platform code
- [ ] `contracts/openapi/<name>.yaml` exists and routes validate against it

Runtime
- [ ] Config from environment, validated at start; unknown or missing values stop the process
- [ ] `GET /health/live` and `GET /health/ready` (database, broker, required upstreams)
- [ ] JSON logs with `service`, `correlation_id`, `trace_id`; redaction list applied
- [ ] `X-Correlation-Id` accepted, propagated to HTTP calls and messages
- [ ] OpenTelemetry started before other imports; spans for HTTP, pg, amqp
- [ ] Graceful shutdown on SIGTERM
- [ ] Outgoing calls go through the resilient client with timeout, retry (GET only), breaker

Data
- [ ] Own schema, migrations in `services/<name>/migrations/`
- [ ] Connects as `svc_<name>`; start-up check refuses a superuser or `app_admin`
- [ ] No query mentions another service's schema
- [ ] Commands are transactional; events go through the outbox; consumers use the inbox

Delivery
- [ ] Image from `infra/docker/service.Dockerfile` with `--build-arg SERVICE=services/<name>`
      (multi-stage, production dependencies only, runs as `node`, sources read-only,
      `HEALTHCHECK` on `/health/ready`); `docker stop` ends with "stopped" and exit code 0
- [ ] Compose entry in both profiles, no host port in `full`
- [ ] Unit and integration tests (`@heatmap/testing`: real bootstrap, connect as `svc_<name>`); contract tests for every endpoint
- [ ] Row in `docs/02-architecture.md#services` and in `docs/07-requirements-matrix.md`
