import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { currentContext } from './context.ts';
import { ConflictError, ServiceUnavailableError } from './errors.ts';
import { createServer } from './server.ts';
import { captureLogger } from './test-support.ts';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function build(readiness: Record<string, () => Promise<void>> = {}) {
  const captured = captureLogger('sample');
  app = createServer({ logger: captured.logger, readiness, readinessTimeoutMs: 100 });
  app.get('/context', async (req) => {
    req.log.info('handler');
    return currentContext() ?? null;
  });
  app.post(
    '/items',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string', minLength: 2 } },
          additionalProperties: false,
        },
      },
    },
    async () => ({ ok: true }),
  );
  app.get('/conflict', async () => {
    throw new ConflictError('already 20 places', { type: '/problems/place-limit' });
  });
  app.get('/busy', async () => {
    throw new ServiceUnavailableError('queue full', 7);
  });
  app.get('/db-busy', async () => {
    throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
  });
  app.get('/boom', async () => {
    throw new Error('SELECT secret FROM users failed');
  });
  return { app, ...captured };
}

describe('server factory', () => {
  it('answers 503 with Retry-After, without details, while the database is overloaded', async () => {
    const { app, lines } = build();
    const res = await app.inject('/db-busy');
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(res.json()).toMatchObject({ type: '/problems/database-busy', detail: 'The service is busy right now.' });
    expect(res.body).not.toContain('statement');
    expect(JSON.stringify(lines)).toContain('canceling statement'); // the cause stays in the log
  });

  it('answers liveness and readiness', async () => {
    const { app } = build({ database: async () => undefined });
    expect((await app.inject('/health/live')).json()).toEqual({ status: 'ok' });
    const ready = await app.inject('/health/ready');
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ok', checks: { database: { status: 'ok' } } });
  });

  it('reports a failing or hanging dependency as 503', async () => {
    const { app } = build({
      database: async () => {
        throw new Error('connection refused');
      },
      broker: () => new Promise(() => undefined),
    });
    const ready = await app.inject('/health/ready');
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toMatchObject({
      status: 'unavailable',
      checks: {
        database: { status: 'unavailable', detail: 'connection refused' },
        broker: { status: 'unavailable', detail: 'timed out after 100 ms' },
      },
    });
  });

  it('takes the correlation id from the header, logs it and returns it', async () => {
    const { app, lines } = build();
    const res = await app.inject({
      url: '/context',
      headers: { 'x-correlation-id': 'corr-42', 'x-user-id': 'u-1', 'x-user-role': 'user' },
    });
    expect(res.headers['x-correlation-id']).toBe('corr-42');
    expect(res.json()).toEqual({ correlationId: 'corr-42', userId: 'u-1', userRole: 'user' });
    const handlerLine = lines.find((l) => l['msg'] === 'handler');
    const completion = lines.find((l) => l['msg'] === 'request completed');
    expect(handlerLine).toMatchObject({ correlation_id: 'corr-42', service: 'sample' });
    expect(completion).toMatchObject({ correlation_id: 'corr-42', method: 'GET', route: '/context', status: 200 });
    expect(typeof completion?.['duration_ms']).toBe('number');
  });

  it('generates a UUID when the header is missing or malformed', async () => {
    const { app } = build();
    for (const headers of [{}, { 'x-correlation-id': 'bad id with spaces' }]) {
      const res = await app.inject({ url: '/context', headers });
      expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('turns schema violations into a 400 problem with field errors', async () => {
    const { app } = build();
    const res = await app.inject({ method: 'POST', url: '/items', payload: { name: 'x', extra: 1 } });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = res.json();
    expect(body).toMatchObject({ type: '/problems/validation', status: 400, instance: '/items' });
    expect(body.correlationId).toBe(res.headers['x-correlation-id']);
    expect(body.errors.map((e: { path: string }) => e.path)).toEqual(expect.arrayContaining(['/body/name', '/body']));
  });

  it('maps typed errors to their status and adds Retry-After', async () => {
    const { app } = build();
    const conflict = await app.inject('/conflict');
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      type: '/problems/place-limit',
      title: 'Conflict',
      detail: 'already 20 places',
    });
    const busy = await app.inject('/busy');
    expect(busy.statusCode).toBe(503);
    expect(busy.headers['retry-after']).toBe('7');
  });

  it('hides unexpected errors from the client but logs them', async () => {
    const { app, lines } = build();
    const res = await app.inject({ url: '/boom?q=1%20Main%20St', headers: { 'x-correlation-id': 'c-500' } });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('SELECT');
    expect(res.json()).toMatchObject({ title: 'Internal error', instance: '/boom', correlationId: 'c-500' });
    expect(res.body).not.toContain('Main');
    const logged = lines.find((l) => l['msg'] === 'request failed');
    expect(JSON.stringify(logged)).toContain('SELECT secret');
    expect(logged).toMatchObject({ correlation_id: 'c-500', level: 'error' });
  });

  it('answers unknown routes with a 404 problem', async () => {
    const { app } = build();
    const res = await app.inject('/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ status: 404, title: 'Not found' });
  });

  it('reports not ready once shutdown begins, while still accepting the probe', async () => {
    const { app } = build();
    let url = '';
    let readyDuringClose: number | undefined;
    app.addHook('preClose', async () => {
      readyDuringClose = (await fetch(`${url}/health/ready`)).status;
    });
    url = await app.listen({ port: 0, host: '127.0.0.1' });
    await app.close();
    expect(readyDuringClose).toBe(503);
    expect(app.isShuttingDown()).toBe(true);
  });
});
