import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { text } from 'node:stream/consumers';
import { captureLogger } from '@heatmap/common/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { Upstream } from './upstream.ts';

let server: Server | undefined;
let calls = 0;

async function service(listener: RequestListener, options = {}): Promise<Upstream> {
  calls = 0;
  server = createServer((req, res) => {
    calls++;
    listener(req, res);
  });
  await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r));
  return upstream(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, options);
}
const upstream = (baseUrl: string, options = {}) =>
  new Upstream({
    name: 'places',
    baseUrl,
    timeoutMs: 2_000,
    breakerThreshold: 2,
    breakerHalfOpenMs: 60_000,
    logger: captureLogger('gateway').logger,
    ...options,
  });

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((r) => (server === undefined ? r() : server.close(() => r())));
  server = undefined;
});

describe('upstream', () => {
  it('sends method, path, headers and body and returns the answer as it is', async () => {
    const up = await service(async (req, res) => {
      res.writeHead(409, { 'x-seen': `${req.method} ${req.url} ${req.headers['x-a']}` }).end(await text(req));
    });
    const r = await up.send('POST', '/places?x=1', { 'x-a': 'b' }, Buffer.from('{}'));
    expect(r.statusCode).toBe(409);
    expect(r.headers['x-seen']).toBe('POST /places?x=1 b');
    expect(await r.body.text()).toBe('{}');
  });

  it('passes errors of the service through without opening the circuit', async () => {
    const up = await service((_, res) => res.writeHead(calls % 2 === 0 ? 500 : 503).end());
    for (const expected of [503, 500, 503, 500, 503]) {
      const r = await up.send('GET', '/', {}, undefined);
      await r.body.dump();
      expect(r.statusCode).toBe(expected);
    }
  });

  it.each([502, 504])('counts %i as a failure and fails fast after the threshold', async (status) => {
    const up = await service((_, res) => res.writeHead(status).end());
    for (let i = 0; i < 2; i++) {
      await expect(up.send('GET', '/', {}, undefined)).rejects.toMatchObject({
        status: 503,
        type: '/problems/upstream-unavailable',
        retryAfterS: 5,
      });
    }
    await expect(up.send('GET', '/', {}, undefined)).rejects.toMatchObject({ status: 503, retryAfterS: 60 });
    expect(calls).toBe(2);
  });

  it('closes the circuit again after a successful probe', async () => {
    let broken = true;
    const up = await service((_, res) => res.writeHead(broken ? 502 : 200).end(), { breakerHalfOpenMs: 50 });
    for (let i = 0; i < 2; i++) {
      await expect(up.send('GET', '/', {}, undefined)).rejects.toThrow();
    }
    broken = false;
    await expect.poll(async () => (await up.send('GET', '/', {}, undefined)).statusCode).toBe(200);
  });

  it('a slow service is a timeout, an unreachable one is unavailable', async () => {
    const up = await service(() => undefined, { timeoutMs: 50 });
    await expect(up.send('GET', '/', {}, undefined)).rejects.toMatchObject({ type: '/problems/upstream-timeout' });
    await expect(upstream('http://127.0.0.1:1').send('GET', '/', {}, undefined)).rejects.toMatchObject({
      type: '/problems/upstream-unavailable',
    });
  });

  it('is ready only when the service says so', async () => {
    const up = await service((req, res) => res.writeHead(req.url === '/health/ready' && calls === 1 ? 200 : 503).end());
    await expect(up.ready()).resolves.toBeUndefined();
    await expect(up.ready()).rejects.toThrow(/not ready \(503\)/);
  });
});
