// Preloaded with `node --import @heatmap/common/otel src/main.ts` so instrumentation hooks are in
// place before the service imports http, pg or amqplib. Reads SERVICE_NAME and
// OTEL_EXPORTER_OTLP_ENDPOINT; without an endpoint nothing is started.
import { register } from 'node:module';
import { startTracing } from './tracing.ts';

// ESM loader hook so instrumentations also patch modules loaded with `import`.
register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

startTracing({
  serviceName: process.env['SERVICE_NAME'] ?? 'unknown-service',
  endpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'],
});
