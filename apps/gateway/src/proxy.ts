// Routes of the public API, generated from the contracts (@heatmap/contracts `routes`): for each
// one, authenticate, authorise, rate-limit and forward to the service. X-User-Id and X-User-Role
// sent by a client are always removed; they are set only from a verified token.
import {
  ForbiddenError,
  TooManyRequestsError,
  UnauthorizedError,
  type FastifyInstance,
  type FastifyRequest,
} from '@heatmap/common';
import { routes, type Route, type ServiceName } from '@heatmap/contracts';
import type { Authenticator, Caller } from './auth.ts';
import type { RateLimiter } from './rate-limit.ts';
import type { Upstream } from './upstream.ts';

export const PREFIX = '/api/v1';

/** Never forwarded to a service (hop-by-hop, credentials the gateway consumes, spoofable identity). */
const DROPPED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'authorization',
  'x-user-id',
  'x-user-role',
  'x-correlation-id',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-forwarded-host',
  'traceparent',
  'tracestate',
]);
const DROPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'trailer',
  'upgrade',
  'x-correlation-id',
  'x-powered-by',
  'server',
]);

export interface ProxyDeps {
  readonly authenticator: Authenticator;
  readonly limiter: RateLimiter;
  readonly upstreams: Record<ServiceName, Upstream>;
}

declare module 'fastify' {
  interface FastifyRequest {
    caller?: Caller;
  }
  interface FastifyContextConfig {
    route?: Route;
  }
}

function forwardedHeaders(req: FastifyRequest, caller: Caller | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined && !DROPPED_REQUEST_HEADERS.has(name)) {
      headers[name] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  headers['x-correlation-id'] = req.id;
  headers['x-forwarded-for'] = req.ip;
  headers['x-forwarded-proto'] = req.protocol;
  if (caller !== undefined) {
    headers['x-user-id'] = caller.userId;
    headers['x-user-role'] = caller.role;
  }
  return headers;
}

function upstreamPath(route: Route, req: FastifyRequest): string {
  const params = req.params as Record<string, string>;
  const path = route.path.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(params[name] ?? ''));
  const q = req.url.indexOf('?');
  return q === -1 ? path : path + req.url.slice(q);
}

export function registerProxyRoutes(app: FastifyInstance, { authenticator, limiter, upstreams }: ProxyDeps): void {
  for (const route of routes) {
    app.route({
      method: route.method,
      url: PREFIX + route.path.replace(/\{(\w+)\}/g, ':$1'),
      config: { route },
      preHandler: async (req, reply) => {
        // 1. Who is calling. An invalid token is an error even on public routes.
        const caller = await authenticator.fromHeader(req.headers.authorization).catch((error: unknown) => {
          reply.header('www-authenticate', 'Bearer error="invalid_token"');
          throw error;
        });
        // 2. May they.
        if (route.access !== 'public' && caller === undefined) {
          reply.header('www-authenticate', 'Bearer');
          throw new UnauthorizedError('Sign in to use this endpoint.', { type: '/problems/authentication-required' });
        }
        if (route.access === 'admin' && caller?.role !== 'admin') {
          throw new ForbiddenError('Administrators only.', { type: '/problems/admin-only' });
        }
        if (caller !== undefined) {
          req.caller = caller;
        }
        // 3. How often.
        const limit =
          caller === undefined
            ? (route.rateLimit.anonymousPerMinute ?? route.rateLimit.perMinute)
            : route.rateLimit.perMinute;
        const subject = caller === undefined ? `ip:${req.ip}` : `user:${caller.userId}`;
        const decision = await limiter.hit(route.operationId, subject, limit);
        reply.header('ratelimit-limit', String(decision.limit));
        reply.header('ratelimit-remaining', String(decision.remaining));
        reply.header('ratelimit-reset', String(decision.resetS));
        if (!decision.allowed) {
          throw new TooManyRequestsError(
            `Limit of ${limit} requests per window reached for this endpoint.`,
            decision.resetS,
            {
              type: '/problems/rate-limited',
            },
          );
        }
      },
      handler: async (req, reply) => {
        const upstream = upstreams[route.service];
        const response = await upstream.send(
          req.method,
          upstreamPath(route, req),
          forwardedHeaders(req, req.caller),
          req.body as Buffer | undefined,
        );
        reply.status(response.statusCode);
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined && !DROPPED_RESPONSE_HEADERS.has(name)) {
            reply.header(name, value);
          }
        }
        return reply.send(response.body);
      },
    });
  }
}
