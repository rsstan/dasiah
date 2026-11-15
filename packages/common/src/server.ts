// Fastify server factory used by every service and the gateway. Gives each app:
// - correlation id: taken from X-Correlation-Id (or generated), kept in the request context,
//   returned in the response header;
// - request context: correlation id and the caller from X-User-Id / X-User-Role;
// - one completion log line per request (method, route, status, duration);
// - errors as application/problem+json (RFC 9457), no stack traces or SQL to the client;
// - GET /health/live and GET /health/ready (named readiness checks with a timeout);
// - graceful shutdown on SIGTERM/SIGINT: readiness turns 503, new connections are refused,
//   in-flight requests finish, onClose hooks (pools, consumers) run, spans are flushed.
import { STATUS_CODES } from 'node:http';
import { trace } from '@opentelemetry/api';
import Fastify, {
  LogController,
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { correlationIdFrom, CORRELATION_HEADER, runWithContext } from './context.ts';
import { AppError, ServiceUnavailableError, TooManyRequestsError } from './errors.ts';
import type { Logger } from './logger.ts';
import { stopTracing } from './tracing.ts';

export type ReadinessCheck = () => Promise<void>;

export interface ServerOptions {
  readonly logger: Logger;
  /** Named dependencies checked by GET /health/ready, e.g. `{ database: () => ping(pool) }`. */
  readonly readiness?: Record<string, ReadinessCheck>;
  readonly readinessTimeoutMs?: number;
  readonly bodyLimit?: number;
  /**
   * Take the client address from X-Forwarded-For. Only for services reachable solely through
   * the gateway on the internal network.
   */
  readonly trustProxy?: boolean;
}

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  correlationId?: string;
  errors?: readonly { path: string; message: string }[];
}

const PROBLEM_TYPE = 'application/problem+json';

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function path(req: FastifyRequest): string {
  const q = req.url.indexOf('?');
  return q === -1 ? req.url : req.url.slice(0, q); // the query may hold an address: never echo it
}

/** Maps any thrown value to a problem; unknown errors become a generic 500. */
export function toProblem(error: unknown, req: FastifyRequest): Problem {
  const base = { instance: path(req), correlationId: req.id };
  if (error instanceof AppError) {
    return {
      type: error.type,
      title: error.title,
      status: error.status,
      detail: error.message,
      ...base,
      ...(error.errors === undefined ? {} : { errors: error.errors }),
    };
  }
  const fastifyError = error as Partial<FastifyError>;
  if (Array.isArray(fastifyError.validation)) {
    const where = fastifyError.validationContext ?? 'request';
    return {
      type: '/problems/validation',
      title: 'Invalid request',
      status: 400,
      detail: `The ${where} does not match the contract.`,
      ...base,
      errors: fastifyError.validation.map((v) => ({
        path: `/${where}${v.instancePath}`,
        message: v.message ?? 'is invalid',
      })),
    };
  }
  const status = fastifyError.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return {
      type: 'about:blank',
      title: STATUS_CODES[status] ?? 'Client error',
      status,
      detail: fastifyError.message,
      ...base,
    };
  }
  return {
    type: 'about:blank',
    title: 'Internal error',
    status: 500,
    detail: 'An unexpected error occurred. Quote the correlation id when reporting it.',
    ...base,
  };
}

function sendProblem(reply: FastifyReply, problem: Problem, retryAfterS?: number): FastifyReply {
  if (retryAfterS !== undefined) {
    reply.header('retry-after', String(Math.max(1, Math.ceil(retryAfterS))));
  }
  return reply.status(problem.status).type(PROBLEM_TYPE).send(problem);
}

export function createServer({
  logger,
  readiness = {},
  readinessTimeoutMs = 2_000,
  bodyLimit = 1_048_576,
  trustProxy = false,
}: ServerOptions): FastifyInstance {
  let shuttingDown = false;
  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    // Fastify's own per-request lines are off; the onResponse hook writes one line per request.
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit,
    trustProxy,
    // The request logger is the service logger: the correlation id comes from the context mixin.
    childLoggerFactory: (parent) => parent,
    genReqId: (req) => correlationIdFrom(headerValue(req.headers[CORRELATION_HEADER])),
    ajv: { customOptions: { allErrors: true, removeAdditional: false } },
  });

  app.decorate('isShuttingDown', () => shuttingDown);
  // preClose runs before the listener stops, so readiness reports 503 while requests drain.
  app.addHook('preClose', async () => {
    shuttingDown = true;
  });

  app.addHook('onRequest', (req, reply, done) => {
    reply.header(CORRELATION_HEADER, req.id);
    const route = req.routeOptions.url;
    if (route !== undefined) {
      const span = trace.getActiveSpan();
      span?.updateName(`${req.method} ${route}`);
      span?.setAttribute('http.route', route);
    }
    const userId = headerValue(req.headers['x-user-id']);
    const userRole = headerValue(req.headers['x-user-role']);
    runWithContext(
      {
        correlationId: req.id,
        ...(userId === undefined ? {} : { userId }),
        ...(userRole === undefined ? {} : { userRole }),
      },
      done,
    );
  });

  app.addHook('onResponse', (req, reply, done) => {
    const route = req.routeOptions.url ?? 'unmatched';
    const fields = {
      method: req.method,
      route,
      status: reply.statusCode,
      duration_ms: Math.round(reply.elapsedTime),
    };
    if (route.startsWith('/health/')) {
      req.log.debug(fields, 'request completed');
    } else if (reply.statusCode >= 500) {
      req.log.error(fields, 'request completed');
    } else {
      req.log.info(fields, 'request completed');
    }
    done();
  });

  app.setErrorHandler((error, req, reply) => {
    const problem = toProblem(error, req);
    if (problem.status >= 500) {
      req.log.error({ err: error }, 'request failed');
    } else {
      req.log.debug({ problem: problem.type, status: problem.status }, 'request rejected');
    }
    const retryAfter =
      error instanceof TooManyRequestsError || error instanceof ServiceUnavailableError ? error.retryAfterS : undefined;
    return sendProblem(reply, problem, retryAfter);
  });

  app.setNotFoundHandler((req, reply) =>
    sendProblem(reply, {
      type: 'about:blank',
      title: 'Not found',
      status: 404,
      detail: `No route for ${req.method} ${path(req)}`,
      instance: path(req),
      correlationId: req.id,
    }),
  );

  app.get('/health/live', async () => ({ status: 'ok' as const }));

  app.get('/health/ready', async (_req, reply) => {
    const checks: Record<string, { status: 'ok' | 'unavailable'; detail?: string }> = {};
    if (shuttingDown) {
      checks['shutdown'] = { status: 'unavailable', detail: 'shutting down' };
    }
    await Promise.all(
      Object.entries(readiness).map(async ([name, check]) => {
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            check(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`timed out after ${readinessTimeoutMs} ms`)),
                readinessTimeoutMs,
              );
            }),
          ]);
          checks[name] = { status: 'ok' };
        } catch (error) {
          checks[name] = { status: 'unavailable', detail: error instanceof Error ? error.message : String(error) };
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    const ok = Object.values(checks).every((c) => c.status === 'ok');
    return reply.status(ok ? 200 : 503).send({ status: ok ? 'ok' : 'unavailable', checks });
  });

  return app;
}

export interface RunOptions {
  readonly host: string;
  readonly port: number;
  readonly shutdownTimeoutMs: number;
}

/**
 * Listens and installs the shutdown handlers. Resolves once listening. On SIGTERM or SIGINT the
 * app is closed (in-flight requests finish, onClose hooks run), spans are flushed and the
 * process exits; if that takes longer than `shutdownTimeoutMs` it exits with code 1.
 */
export async function runServer(app: FastifyInstance, { host, port, shutdownTimeoutMs }: RunOptions): Promise<void> {
  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) {
      return;
    }
    stopping = true;
    app.log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      app.log.error({ timeout_ms: shutdownTimeoutMs }, 'shutdown timed out');
      process.exit(1);
    }, shutdownTimeoutMs);
    timer.unref();
    app
      .close()
      .then(() => stopTracing())
      .then(() => {
        app.log.info('stopped');
        process.exit(0);
      })
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'shutdown failed');
        process.exit(1);
      });
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
  await app.listen({ host, port });
}

declare module 'fastify' {
  interface FastifyInstance {
    /** true once shutdown has begun. */
    isShuttingDown(): boolean;
  }
}
