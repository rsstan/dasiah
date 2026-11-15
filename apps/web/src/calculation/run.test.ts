import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, buildUrl, describeError } from '../api/client.ts';
import { runCalculation } from './run.ts';

const calc = (status: 'running' | 'done' | 'failed', errorCode: string | null = null) => ({
  calculationId: '00000000-0000-4000-8000-000000000001',
  status,
  cityCode: 'vno',
  originH3: '8a1f2669803ffff',
  feedVersionId: 1,
  date: '2026-12-02',
  time: '08:00',
  windowMinutes: 0,
  cellCount: status === 'done' ? 1 : null,
  durationMs: status === 'done' ? 1200 : null,
  createdAt: '2026-11-15T10:00:00Z',
  expiresAt: '2026-11-16T10:00:00Z',
  errorCode,
});
const results = { calculationId: calc('done').calculationId, resolution: 9, cells: [] };

type Reply = [number, unknown, Record<string, string>?];
function stubFetch(replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const [status, body, headers] = replies.shift() ?? [500, { title: 'no more replies' }];
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const input = { cityCode: 'vno', origin: { lat: 54.687, lon: 25.28 }, windowMinutes: 0 };

describe('runCalculation', () => {
  it('posts, then fetches results; 200 means the cache answered', async () => {
    const calls = stubFetch([
      [200, calc('done')],
      [200, results],
    ]);
    const outcome = await runCalculation(input);
    expect(outcome).toMatchObject({ cached: true, results });
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'POST /api/v1/calculations',
      `GET /api/v1/calculations/${results.calculationId}/results`,
    ]);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual(input);
  });

  it('polls a calculation that another request is computing (202)', async () => {
    const calls = stubFetch([
      [202, calc('running')],
      [200, calc('running')],
      [200, calc('done')],
      [200, results],
    ]);
    const outcome = await runCalculation(input, { pollIntervalMs: 1 });
    expect(outcome.cached).toBe(false);
    expect(calls).toHaveLength(4);
  });

  it('explains a failed calculation', async () => {
    stubFetch([
      [202, calc('running')],
      [200, calc('failed', 'osrm_unavailable')],
    ]);
    await expect(runCalculation(input, { pollIntervalMs: 1 })).rejects.toThrow(/Car routing is unavailable/);
  });

  it('turns problem+json into ApiError with Retry-After and correlation id', async () => {
    stubFetch([
      [
        429,
        { type: 'about:blank', title: 'Too many requests', status: 429 },
        { 'retry-after': '17', 'x-correlation-id': 'abc' },
      ],
    ]);
    const error = await runCalculation(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, retryAfterS: 17, correlationId: 'abc' });
    expect(describeError(error)).toBe('Too many requests. Try again in 17 s.');
  });

  it('words known problems for people', async () => {
    stubFetch([
      [
        422,
        {
          type: '/problems/origin-outside-city',
          title: 'Unprocessable',
          detail: 'The origin is outside vno.',
          status: 422,
        },
      ],
    ]);
    const error = await runCalculation(input).catch((e: unknown) => e);
    expect(describeError(error)).toBe('The start point is outside the selected city. Pick a point inside it.');
  });

  it('reports an unreachable server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const error = await runCalculation(input).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 0 });
    expect(describeError(error)).toMatch(/cannot be reached/);
  });

  it('builds query strings without empty values', () => {
    expect(buildUrl('/geocode', { city: 'vno', q: 'Gedimino 9', x: undefined, y: '' })).toBe(
      '/api/v1/geocode?city=vno&q=Gedimino+9',
    );
  });
});
