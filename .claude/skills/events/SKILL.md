---
name: events
description: Publish a new event, consume an event, or change an event payload on RabbitMQ. Covers outbox, inbox, AsyncAPI and dead-lettering.
---

# Events

## New or changed event

1. Describe it in `contracts/asyncapi/heatmap-events.yaml`: channel (routing key = event type
   `<service>.<entity>.<past-tense-verb>.v<N>`), message with the common envelope, payload
   schema. Payload changes that remove or retype a field need a new version `v<N+1>`.
2. `pnpm contracts:lint && pnpm contracts:gen`.
3. Add the event to the table in `docs/04-contracts.md`.

## Publishing

- Never publish from a handler directly. Insert into `<schema>.outbox` inside the transaction
  that changes the state (or inside the SQL procedure that does it).
- The outbox loop from `packages/common/messaging` publishes with confirms, sets `published_at`,
  and carries `correlationId` and `traceparent`.
- Payloads contain ids and facts, not personal data. If a user id is unavoidable, configure
  that event type for immediate deletion from the outbox after publishing.

## Consuming

1. Add a `receive` operation to `contracts/asyncapi/heatmap-events.yaml` with `x-consumer` and
   `x-queue: <consumer>.<event>`, then `pnpm contracts:gen`. The messaging package declares the
   queue (quorum, delivery limit 5, dead-letter to `heatmap.dlx`) and its binding to
   `heatmap.events` from the generated `topology`.
2. Handler rules:
   - validate the envelope and payload with `validateEvent()` from `@heatmap/contracts`;
     invalid -> reject without requeue (goes to the DLQ);
   - in one transaction: `INSERT INTO processed_messages (message_id, event_type) ... ON
     CONFLICT DO NOTHING`; if no row was inserted, acknowledge and return; otherwise apply the
     effect;
   - restore correlation id and trace context before logging anything;
   - transient failure -> negative acknowledge with requeue; the delivery limit ends the loop.
3. Tests: effect applied once for a duplicated message; poison message reaches the DLQ; the
   consumer survives a broker restart.
