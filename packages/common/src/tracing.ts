// OpenTelemetry SDK: traces exported over OTLP/HTTP (Jaeger), automatic spans for inbound and
// outbound HTTP (node:http, fetch/undici) and PostgreSQL. W3C `traceparent` is propagated on
// every outgoing call. Started by src/otel-register.ts before any other module is imported.
import { context, propagation, trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

export interface TracingOptions {
  readonly serviceName: string;
  /** OTLP base URL, e.g. http://localhost:4318. Without it tracing is not started. */
  readonly endpoint: string | undefined;
}

let sdk: NodeSDK | undefined;

export function startTracing({ serviceName, endpoint }: TracingOptions): boolean {
  if (sdk !== undefined || endpoint === undefined || endpoint === '') {
    return false;
  }
  sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` }),
    instrumentations: [
      new HttpInstrumentation({
        // Probes and the exporter's own requests are noise.
        ignoreIncomingRequestHook: (req) => req.url?.startsWith('/health/') ?? false,
      }),
      new UndiciInstrumentation(),
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
    ],
  });
  sdk.start();
  return true;
}

/** Flushes pending spans; called on shutdown. */
export async function stopTracing(): Promise<void> {
  const current = sdk;
  sdk = undefined;
  await current?.shutdown();
}

const tracer = () => trace.getTracer('heatmap');

/** Runs `fn` inside a manual span (e.g. `raptor.query`), recording errors on it. */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes: Record<string, string | number | boolean> = {},
): Promise<T> {
  return tracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

/** Trace context of the active span as carrier headers (`traceparent`), e.g. for AMQP messages. */
export function injectTraceHeaders(carrier: Record<string, string> = {}): Record<string, string> {
  propagation.inject(context.active(), carrier);
  return carrier;
}

/** Runs `fn` in the trace context found in `headers` (e.g. of a consumed message). */
export function withExtractedContext<T>(headers: Record<string, unknown>, fn: () => T): T {
  const carrier = Object.fromEntries(
    Object.entries(headers).flatMap(([k, v]) => (typeof v === 'string' ? [[k.toLowerCase(), v]] : [])),
  );
  return context.with(propagation.extract(context.active(), carrier), fn);
}
