// Assembles the gateway: Redis (rate limits), JWKS verifier, one resilient upstream per service,
// CORS, security headers, the public routes and aggregated readiness. Used by main.ts and tests.
import cors from '@fastify/cors';
import { createServer, type FastifyInstance, type Logger } from '@heatmap/common';
import type { ServiceName } from '@heatmap/contracts';
import { createClient } from 'redis';
import { Authenticator } from './auth.ts';
import type { Config } from './config.ts';
import { PREFIX, registerProxyRoutes } from './proxy.ts';
import { RateLimiter } from './rate-limit.ts';
import { Upstream } from './upstream.ts';

/** Sent on every response; the API serves JSON only, never documents to render. */
const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-resource-policy': 'same-site',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

export interface Gateway {
  readonly app: FastifyInstance;
  readonly upstreams: Record<ServiceName, Upstream>;
}

export async function createGateway(config: Config, logger: Logger): Promise<Gateway> {
  const redis = createClient({
    url: config.REDIS_URL,
    socket: { connectTimeout: 2_000, reconnectStrategy: (n) => Math.min(n * 200, 5_000) },
  });
  redis.on('error', (error: Error) => logger.warn({ err: error }, 'redis error'));
  await redis.connect();

  const upstream = (name: ServiceName, baseUrl: string, timeoutMs = config.UPSTREAM_TIMEOUT_MS) =>
    new Upstream({
      name,
      baseUrl,
      timeoutMs,
      breakerThreshold: config.BREAKER_THRESHOLD,
      breakerHalfOpenMs: config.BREAKER_HALF_OPEN_MS,
      logger,
    });
  const upstreams: Record<ServiceName, Upstream> = {
    identity: upstream('identity', config.IDENTITY_URL),
    'transit-data': upstream('transit-data', config.TRANSIT_URL),
    accessibility: upstream('accessibility', config.ACCESSIBILITY_URL, config.ACCESSIBILITY_TIMEOUT_MS),
    places: upstream('places', config.PLACES_URL),
  };

  const app = createServer({
    logger,
    trustProxy: config.TRUST_PROXY,
    identityHeaders: false,
    bodyLimit: config.BODY_LIMIT_BYTES,
    readiness: {
      redis: async () => {
        await redis.ping();
      },
      ...Object.fromEntries(Object.entries(upstreams).map(([name, u]) => [name, () => u.ready()])),
    },
  });

  // Bodies are forwarded byte for byte; the services validate them against the contracts.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.addHook('onSend', async (_req, reply) => {
    reply.headers(SECURITY_HEADERS);
  });
  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', 'x-correlation-id'],
    exposedHeaders: [
      'x-correlation-id',
      'retry-after',
      'location',
      'ratelimit-limit',
      'ratelimit-remaining',
      'ratelimit-reset',
    ],
    maxAge: 600,
  });

  registerProxyRoutes(app, {
    authenticator: new Authenticator({
      identityUrl: config.IDENTITY_URL,
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
    }),
    limiter: new RateLimiter(redis, config.RATE_LIMIT_WINDOW_S, logger),
    upstreams,
  });
  logger.debug({ prefix: PREFIX }, 'routes registered');

  app.addHook('onClose', async () => {
    await redis.quit();
  });
  return { app, upstreams };
}
