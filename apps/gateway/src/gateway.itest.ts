// Gateway against real Redis and stub services (Fastify servers that record what reached them;
// the identity stub publishes the JWKS). Covers routing, header hygiene, authentication,
// authorisation, rate limits, CORS, security headers, timeouts and the circuit breaker.
import { generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { LightMyRequestResponse } from '@heatmap/common';
import { captureLogger } from '@heatmap/common/testing';
import { startRedis, type TestRedis } from '@heatmap/testing';
import Fastify, { type FastifyInstance } from 'fastify';
import { exportJWK, SignJWT } from 'jose';
import { createClient } from 'redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGateway, type Gateway } from './app.ts';
import { loadGatewayConfig } from './config.ts';

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let redis: TestRedis;
let gateway: Gateway;
const stubs: Record<string, FastifyInstance> = {};
const urls: Record<string, string> = {};
const seen: Record<string, Seen[]> = {};
const captured = captureLogger('gateway');

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const foreignKey = generateKeyPairSync('ed25519').privateKey;
const USER = randomUUID();
const ADMIN = randomUUID();

async function token(
  sub: string,
  role: 'user' | 'admin',
  key: KeyObject = privateKey,
  expiresIn = '15m',
): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' })
    .setSubject(sub)
    .setIssuer('heatmap-identity')
    .setAudience('heatmap')
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

async function startStub(name: string): Promise<void> {
  const app = Fastify();
  seen[name] = [];
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => done(null, body));
  app.get('/.well-known/jwks.json', async () => ({
    keys: [{ ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'EdDSA', use: 'sig' }],
  }));
  app.get('/health/ready', async () => ({ status: 'ok', checks: {} }));
  app.all('/*', async (req, reply) => {
    seen[name]?.push({ method: req.method, url: req.url, headers: req.headers, body: String(req.body ?? '') });
    if (req.url.startsWith('/cities') && req.url.includes('slow=1')) {
      await new Promise((r) => setTimeout(r, 1_000));
    }
    if (req.url.startsWith('/calculations/') && req.url.endsWith('/results')) {
      // Compressed body must pass through untouched.
      return reply
        .header('content-encoding', 'gzip')
        .header('content-type', 'application/json')
        .send(gzipSync('{"cells":[]}'));
    }
    return reply
      .status(req.method === 'POST' ? 201 : 200)
      .header('location', '/api/v1/somewhere')
      .header('set-cookie', 'refresh_token=abc; HttpOnly; Path=/api/v1/auth')
      .header('cache-control', 'no-store')
      .header('x-powered-by', 'stub')
      .send({ service: name, ok: true });
  });
  urls[name] = await app.listen({ port: 0, host: '127.0.0.1' });
  stubs[name] = app;
}

const call = async (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'OPTIONS',
  url: string,
  headers: Record<string, string> = {},
  payload?: string,
): Promise<LightMyRequestResponse> =>
  gateway.app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });

const lastSeen = (name: string): Seen | undefined => seen[name]?.at(-1);

beforeAll(async () => {
  redis = await startRedis();
  await Promise.all(['identity', 'transit-data', 'accessibility', 'places'].map(startStub));
  const config = loadGatewayConfig({
    SERVICE_NAME: 'gateway',
    PORT: '8080',
    IDENTITY_URL: urls['identity'],
    TRANSIT_URL: urls['transit-data'],
    ACCESSIBILITY_URL: urls['accessibility'],
    PLACES_URL: urls['places'],
    REDIS_URL: redis.url,
    WEB_ORIGIN: 'http://localhost:5173',
    UPSTREAM_TIMEOUT_MS: '300',
    BREAKER_THRESHOLD: '3',
    BREAKER_HALF_OPEN_MS: '30000',
  });
  gateway = await createGateway(config, captured.logger);
  await gateway.app.ready();
});

afterAll(async () => {
  await gateway?.app.close();
  await Promise.all(Object.values(stubs).map((s) => s.close()));
  await redis?.stop();
});

beforeEach(async () => {
  const client = createClient({ url: redis.url });
  await client.connect();
  await client.flushAll();
  await client.quit();
  for (const list of Object.values(seen)) {
    list.length = 0;
  }
});

describe('routing and headers', () => {
  it('forwards a public request with a new correlation id and returns the upstream answer', async () => {
    const res = await call('GET', '/api/v1/cities?lang=en', { authorization: '', 'x-forwarded-for': '6.6.6.6' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ service: 'transit-data', ok: true });
    const upstream = lastSeen('transit-data');
    expect(upstream?.url).toBe('/cities?lang=en');
    expect(upstream?.headers['x-correlation-id']).toBe(res.headers['x-correlation-id']);
    expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    // The client cannot choose the address the services see (no trusted proxy in front here).
    expect(upstream?.headers['x-forwarded-for']).toBe('127.0.0.1');
    expect(res.headers).toMatchObject({
      location: '/api/v1/somewhere',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'ratelimit-limit': '120',
      'ratelimit-remaining': '119',
    });
    expect(res.headers['set-cookie']).toContain('refresh_token=abc');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('keeps the caller correlation id and forwards body and cookies byte for byte', async () => {
    const body = '{"email":"a@example.com","password":"p4ssw0rd-long"}';
    const res = await call(
      'POST',
      '/api/v1/auth/login',
      { 'content-type': 'application/json', 'x-correlation-id': 'client-corr-1', cookie: 'refresh_token=xyz' },
      body,
    );
    expect(res.statusCode).toBe(201);
    expect(res.headers['x-correlation-id']).toBe('client-corr-1');
    const upstream = lastSeen('identity');
    expect(upstream).toMatchObject({ method: 'POST', url: '/auth/login', body });
    expect(upstream?.headers).toMatchObject({
      'content-type': 'application/json',
      cookie: 'refresh_token=xyz',
      'x-correlation-id': 'client-corr-1',
    });
  });

  it('passes compressed bodies through untouched', async () => {
    const res = await call('GET', `/api/v1/calculations/${randomUUID()}/results`, { 'accept-encoding': 'gzip' });
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.rawPayload.equals(gzipSync('{"cells":[]}'))).toBe(true);
  });

  it('does not expose internal paths and answers unknown routes with a problem', async () => {
    for (const path of ['/api/v1/internal/cities/waw/active-feed', '/api/v1/.well-known/jwks.json', '/api/v1/nope']) {
      const res = await call('GET', path);
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
    }
    expect(seen['transit-data']).toHaveLength(0);
  });

  it('allows the web origin with credentials and nobody else', async () => {
    const preflight = {
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,content-type',
    };
    const ok = await call('OPTIONS', '/api/v1/calculations', { origin: 'http://localhost:5173', ...preflight });
    expect(ok.statusCode).toBe(204);
    expect(ok.headers).toMatchObject({
      'access-control-allow-origin': 'http://localhost:5173',
      'access-control-allow-credentials': 'true',
    });
    const evil = await call('OPTIONS', '/api/v1/calculations', { origin: 'https://evil.example', ...preflight });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('aggregates readiness of Redis and every service', async () => {
    const res = await call('GET', '/health/ready');
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().checks).sort()).toEqual([
      'accessibility',
      'identity',
      'places',
      'redis',
      'transit-data',
    ]);
  });
});

describe('authentication and authorisation', () => {
  it('401 without a token on a user route; the service is not called', async () => {
    const res = await call('GET', '/api/v1/users/me');
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
    expect(res.json()).toMatchObject({ type: '/problems/authentication-required', status: 401 });
    expect(seen['identity']).toHaveLength(0);
  });

  it('401 for a token signed by another key, an expired token and a malformed header', async () => {
    const cases = [
      `Bearer ${await token(USER, 'user', foreignKey)}`,
      `Bearer ${await token(USER, 'user', privateKey, '-1m')}`,
      'Basic dXNlcjpwYXNz',
    ];
    for (const authorization of cases) {
      const res = await call('GET', '/api/v1/places', { authorization });
      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
    }
    expect(seen['places']).toHaveLength(0);
  });

  it('403 for a user on an admin route; an admin passes with the role header', async () => {
    const asUser = await call('GET', '/api/v1/admin/feed-versions', {
      authorization: `Bearer ${await token(USER, 'user')}`,
    });
    expect(asUser.statusCode).toBe(403);
    expect(asUser.json()).toMatchObject({ type: '/problems/admin-only' });
    expect(seen['transit-data']).toHaveLength(0);

    const asAdmin = await call('GET', '/api/v1/admin/feed-versions', {
      authorization: `Bearer ${await token(ADMIN, 'admin')}`,
    });
    expect(asAdmin.statusCode).toBe(200);
    expect(lastSeen('transit-data')?.headers).toMatchObject({ 'x-user-id': ADMIN, 'x-user-role': 'admin' });
    expect(lastSeen('transit-data')?.headers['authorization']).toBeUndefined();
  });

  it('ignores a spoofed X-User-Id: removed when anonymous, replaced by the token subject otherwise', async () => {
    const spoof = { 'x-user-id': ADMIN, 'x-user-role': 'admin' };
    await call('POST', '/api/v1/calculations', { 'content-type': 'application/json', ...spoof }, '{}');
    expect(lastSeen('accessibility')?.headers['x-user-id']).toBeUndefined();
    expect(lastSeen('accessibility')?.headers['x-user-role']).toBeUndefined();

    await call('GET', '/api/v1/places', { authorization: `Bearer ${await token(USER, 'user')}`, ...spoof });
    expect(lastSeen('places')?.headers).toMatchObject({ 'x-user-id': USER, 'x-user-role': 'user' });

    const adminRoute = await call('GET', '/api/v1/admin/feed-versions', spoof);
    expect(adminRoute.statusCode).toBe(401);
  });
});

describe('rate limits', () => {
  it('429 with Retry-After after the limit of the route group', async () => {
    const statuses: number[] = [];
    let last: LightMyRequestResponse | undefined;
    for (let i = 0; i < 6; i++) {
      last = await call('POST', '/api/v1/auth/register', { 'content-type': 'application/json' }, '{}');
      statuses.push(last.statusCode);
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    expect(seen['identity']).toHaveLength(5);
    expect(last?.json()).toMatchObject({ type: '/problems/rate-limited', status: 429 });
    const retryAfter = Number(last?.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(last?.headers['ratelimit-remaining']).toBe('0');
    // Another route has its own counter.
    expect((await call('GET', '/api/v1/cities')).statusCode).toBe(200);
  });

  it('gives signed-in users a higher calculation limit than anonymous callers, counted per user', async () => {
    const send = (headers: Record<string, string> = {}) =>
      call('POST', '/api/v1/calculations', { 'content-type': 'application/json', ...headers }, '{}');
    const anonymous: number[] = [];
    for (let i = 0; i < 7; i++) {
      anonymous.push((await send()).statusCode);
    }
    expect(anonymous.filter((s) => s === 429)).toHaveLength(1);
    expect(anonymous.at(-1)).toBe(429);

    const auth = { authorization: `Bearer ${await token(USER, 'user')}` };
    const user: number[] = [];
    for (let i = 0; i < 21; i++) {
      user.push((await send(auth)).statusCode);
    }
    expect(user.slice(0, 20).every((s) => s === 201)).toBe(true);
    expect(user[20]).toBe(429);
  });
});

describe('resilience', () => {
  it('turns a slow service into 503 after the timeout', async () => {
    const started = Date.now();
    const res = await call('GET', '/api/v1/cities?slow=1');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ type: '/problems/upstream-timeout' });
    expect(Date.now() - started).toBeLessThan(900);
  });

  it('503 when a service is down; the breaker then fails fast; readiness reports it', async () => {
    await stubs['places']?.close();
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await call('GET', '/api/v1/geocode?city=waw&q=main');
      statuses.push(res.statusCode);
      expect(res.json()).toMatchObject({ type: '/problems/upstream-unavailable' });
      expect(res.headers['retry-after']).toBeDefined();
    }
    expect(statuses).toEqual([503, 503, 503]);
    const open = await call('GET', '/api/v1/geocode?city=waw&q=main');
    expect(open.statusCode).toBe(503);
    expect(open.headers['retry-after']).toBe('30');
    expect(captured.lines.some((l) => l['msg'] === 'circuit opened' && l['upstream'] === 'places')).toBe(true);
    // Other services are not affected.
    expect((await call('GET', '/api/v1/legend')).statusCode).toBe(200);
    const ready = await call('GET', '/health/ready');
    expect(ready.statusCode).toBe(503);
    expect(ready.json().checks.places.status).toBe('unavailable');
  });
});
