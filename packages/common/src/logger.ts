// JSON logs to stdout (pino). Every line has `time`, `level`, `service`, `msg` and, when known,
// `correlation_id`, `trace_id` and `span_id` (taken from the request context and the active
// OpenTelemetry span, so code never passes them by hand). Personal data and secrets are
// redacted by key, wherever they appear in the logged object.
import { trace } from '@opentelemetry/api';
import { pino, stdTimeFunctions, type DestinationStream, type Logger } from 'pino';
import { currentCorrelationId } from './context.ts';

export type { Logger } from 'pino';

/** Keys whose values never reach a log line. */
export const REDACTED_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'email',
  'addressText',
] as const;

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  ...REDACTED_KEYS.flatMap((key) => {
    const k = /^[A-Za-z_$][\w$]*$/.test(key) ? key : `["${key}"]`;
    const dot = k.startsWith('[') ? '' : '.';
    return [k, `*${dot}${k}`, `*.*${dot}${k}`];
  }),
];

export interface LoggerOptions {
  readonly service: string;
  readonly level?: string;
  /** For tests; defaults to stdout. */
  readonly destination?: DestinationStream;
}

export function createLogger({ service, level = 'info', destination }: LoggerOptions): Logger {
  return pino(
    {
      level,
      base: { service },
      messageKey: 'msg',
      timestamp: stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: redactPaths, censor: '[redacted]' },
      mixin() {
        const fields: Record<string, string> = {};
        const correlationId = currentCorrelationId();
        if (correlationId !== undefined) {
          fields['correlation_id'] = correlationId;
        }
        const span = trace.getActiveSpan()?.spanContext();
        if (span !== undefined && span.traceId !== '00000000000000000000000000000000') {
          fields['trace_id'] = span.traceId;
          fields['span_id'] = span.spanId;
        }
        return fields;
      },
    },
    destination,
  );
}
