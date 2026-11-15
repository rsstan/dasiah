import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runWithContext } from './context.ts';
import { ServiceUnavailableError, UpstreamError } from './errors.ts';
import { HttpClient } from './http-client.ts';
import { captureLogger } from './test-support.ts';

let upstream: FastifyInstance;
let baseUrl: string;
const calls: Record<string, number> = {};
let failuresLeft = 0;

beforeAll(async () => {
  upstream = Fastify();
  const count = (key: string) => (calls[key] = (calls[key] ?? 0) + 1);
  upstream.get('/flaky', async (_req, reply) => {
    count('flaky');
    if (failuresLeft > 0) {
      failuresLeft--;
      return reply.status(503).send({ status: 503 });
    }
    return { ok: true };
  });
  upstream.post('/flaky', async (_req, reply) => {
    count('post');
    return reply.status(503).send({ status: 503 });
  });
  upstream.get('/slow', async () => {
    count('slow');
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true };
  });
  upstream.get('/echo', async (req) => ({ correlationId: req.headers['x-correlation-id'] ?? null }));
  upstream.get('/missing', async (_req, reply) => reply.status(404).send({ title: 'Not found' }));
  upstream.get('/down', async (_req, reply) => {
    count('down');
    return reply.status(502).send();
  });
  baseUrl = await upstream.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(() => upstream.close());
beforeEach(() => {
  for (const key of Object.keys(calls)) {
    calls[key] = 0;
  }
  failuresLeft = 0;
});

const client = (overrides: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) =>
  new HttpClient({
    name: 'upstream',
    baseUrl,
    logger: captureLogger().logger,
    timeoutMs: 100,
    retries: 2,
    retryInitialDelayMs: 5,
    breakerThreshold: 3,
    breakerHalfOpenAfterMs: 60_000,
    ...overrides,
  });

describe('HttpClient', () => {
  it('retries an idempotent GET on 503 and succeeds', async () => {
    failuresLeft = 2;
    await expect(client().getJson('/flaky')).resolves.toEqual({ ok: true });
    expect(calls['flaky']).toBe(3);
  });

  it('never retries a POST', async () => {
    await expect(client().request('POST', '/flaky', { body: {} })).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(calls['post']).toBe(1);
  });

  it('times out each attempt and reports the upstream as unavailable', async () => {
    const error = await client({ retries: 0 })
      .getJson('/slow')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect((error as Error).message).toContain('did not answer in time');
  });

  it('opens the breaker after consecutive failures and then fails fast', async () => {
    const c = client({ retries: 0 });
    for (let i = 0; i < 3; i++) {
      await expect(c.getJson('/down')).rejects.toBeInstanceOf(ServiceUnavailableError);
    }
    const error = await c.getJson('/down').catch((e: unknown) => e);
    expect((error as Error).message).toContain('circuit open');
    expect((error as ServiceUnavailableError).retryAfterS).toBe(60);
    expect(calls['down']).toBe(3);
  });

  it('returns client errors to the caller instead of retrying them', async () => {
    const c = client();
    const res = await c.request('GET', '/missing');
    expect(res.status).toBe(404);
    await expect(c.getJson('/missing')).rejects.toBeInstanceOf(UpstreamError);
  });

  it('forwards the correlation id of the current request', async () => {
    const body = await runWithContext({ correlationId: 'corr-7' }, () => client().getJson('/echo'));
    expect(body).toEqual({ correlationId: 'corr-7' });
  });
});
