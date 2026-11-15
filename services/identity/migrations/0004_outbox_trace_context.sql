-- Up Migration
-- Trace context of the transaction that wrote an event, so the publisher can continue the
-- request's trace and correlation id. Filled by default from the transaction-local settings
-- that withTransaction() in packages/common sets, which also covers rows written by SQL
-- procedures.
ALTER TABLE identity.outbox
  ADD COLUMN correlation_id text DEFAULT nullif(current_setting('app.correlation_id', true), ''),
  ADD COLUMN traceparent    text DEFAULT nullif(current_setting('app.traceparent', true), ''),
  ADD CONSTRAINT outbox_correlation_id CHECK (correlation_id ~ '^[A-Za-z0-9._-]{1,128}$'),
  ADD CONSTRAINT outbox_traceparent CHECK (traceparent ~ '^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$');
COMMENT ON COLUMN identity.outbox.correlation_id IS 'Correlation id of the request that caused the event (app.correlation_id); NULL for scheduled work.';
COMMENT ON COLUMN identity.outbox.traceparent IS 'W3C trace context of the writing transaction (app.traceparent); the publisher continues this trace.';

-- Down Migration
ALTER TABLE identity.outbox DROP COLUMN traceparent, DROP COLUMN correlation_id;
