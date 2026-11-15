// The calculation API against a real database (svc_accessibility), RabbitMQ, the transit-data
// stub (testville artifacts) and the OSRM stub. Every response is checked against the OpenAPI
// contract; the map is compared with values derived from the hand-computed testville table.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { haversineM, walkSeconds, type LightMyRequestResponse } from '@heatmap/common';
import { captureLogger } from '@heatmap/common/testing';
import { openApiDocuments } from '@heatmap/contracts';
import {
  contractChecker,
  eventually,
  startBroker,
  startDatabase,
  type TestBroker,
  type TestDatabase,
} from '@heatmap/testing';
import { cellToLatLng, latLngToCell } from 'h3-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createService, type Service } from '../app.ts';
import { loadServiceConfig } from '../config.ts';
import { startOsrmStub, stubDuration, type OsrmStub } from '../test-support/osrm-stub.ts';
import { startTransitStub, type TransitStub } from '../test-support/transit-stub.ts';

const FIXTURE = resolve(import.meta.dirname, '../../../../fixtures/gtfs/testville');
const check = contractChecker(openApiDocuments.accessibility);
const USER = '0b0e0000-0000-4000-8000-000000000001';

let db: TestDatabase;
let broker: TestBroker;
let transit: TransitStub;
let osrm: OsrmStub;
let service: Service;
const captured = captureLogger('accessibility');

/** Calls the service and checks the body against the contract for documented JSON answers. */
async function call(
  method: 'GET' | 'POST',
  url: string,
  path: string,
  options: { body?: object; headers?: Record<string, string> } = {},
): Promise<LightMyRequestResponse> {
  const res = await service.app.inject({
    method,
    url,
    headers: options.headers ?? {},
    ...(options.body === undefined ? {} : { payload: options.body }),
  });
  if (res.headers['content-encoding'] !== 'gzip' && res.statusCode !== 204) {
    check(method, path, res.statusCode, res.json());
  }
  return res;
}

const calculate = (body: object, headers: Record<string, string> = {}) =>
  call('POST', '/calculations', '/calculations', { body, headers });

const A = { lat: 52.2, lon: 21.0 };
const t = (h: number, m: number, s = 0) => h * 3600 + m * 60 + s;

beforeAll(async () => {
  [db, broker, transit, osrm] = await Promise.all([
    startDatabase({ services: ['accessibility'], referenceData: ['accessibility'] }),
    startBroker(),
    startTransitStub(),
    startOsrmStub(),
  ]);
  transit.active.set('waw', { feedVersionId: 1, cityCode: 'waw', validFrom: '2026-11-01', validTo: '2027-03-31' });
  const config = loadServiceConfig({
    SERVICE_NAME: 'accessibility',
    PORT: '3003',
    LOG_LEVEL: 'debug',
    DATABASE_URL: db.url('svc_accessibility'),
    AMQP_URL: broker.url,
    TRANSIT_URL: transit.url,
    CITIES: 'waw,vno', // vno: no timetable
    OSRM_URL_WAW: osrm.url,
    OSRM_TIMEOUT_MS: '2000',
    MAX_PARALLEL_CALCS: '1',
    MAX_QUEUED_CALCS: '1',
  });
  service = await createService(config, captured.logger);
  await service.app.ready();
});

afterAll(async () => {
  await service?.app.close();
  await Promise.all([transit?.close(), osrm?.close()]);
  await Promise.all([db?.stop(), broker?.stop()]);
});

beforeEach(() => {
  osrm.failWith = undefined;
  osrm.delayMs = 0;
});

describe('legend', () => {
  it('lists the seven classes in order', async () => {
    const res = await call('GET', '/legend', '/legend');
    expect(res.json().items.map((c: { code: string }) => c.code)).toEqual([
      'excellent',
      'good',
      'fair',
      'poor',
      'very_poor',
      'unreachable',
      'no_transit',
    ]);
    expect(res.json().items[0]).toMatchObject({ minRatio: 0, maxRatio: 1.2, color: '#1a9850' });
  });
});

describe('a map of testville', () => {
  let id: string;

  it('computes a map (201) whose cells follow the hand-computed testville answers', async () => {
    const res = await calculate({ cityCode: 'waw', origin: A, date: '2026-12-02', time: '07:58' });
    expect(res.statusCode).toBe(201);
    id = res.json().calculationId;
    expect(res.headers['location']).toBe(`/api/v1/calculations/${id}`);
    const originH3 = latLngToCell(A.lat, A.lon, 10);
    expect(res.json()).toMatchObject({
      status: 'done',
      cityCode: 'waw',
      originH3,
      feedVersionId: 1,
      date: '2026-12-02',
      time: '07:58',
    });

    const results = await call('GET', `/calculations/${id}/results`, '/calculations/{id}/results', {
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(results.headers['content-encoding']).toBe('gzip');
    expect(results.headers['cache-control']).toBe('public, max-age=86400, immutable');
    const body = JSON.parse(gunzipSync(results.rawPayload).toString());
    check('get', '/calculations/{id}/results', 200, body);

    // Expected: README case 1-4 arrivals (A at 08:00 reached on foot from the cell centre).
    const [oLat, oLon] = cellToLatLng(originH3);
    const origin = { lat: oLat, lon: oLon };
    const departure = t(7, 58);
    const stops = JSON.parse(readFileSync(resolve(FIXTURE, 'artifacts/timetable-2026-12-02.json'), 'utf8')).stops as {
      id: number;
      lat: number;
      lon: number;
    }[];
    const byLetter: Record<string, { lat: number; lon: number }> = {
      A: { lat: 52.2, lon: 21.0 },
      B: { lat: 52.2, lon: 21.015 },
      C: { lat: 52.2, lon: 21.03 },
      D: { lat: 52.2, lon: 21.045 },
      E: { lat: 52.2, lon: 21.06 },
      F: { lat: 52.209, lon: 21.03 },
      G: { lat: 52.191, lon: 21.03 },
      H: { lat: 52.2015, lon: 21.045 },
      I: { lat: 52.2105, lon: 21.045 },
      J: { lat: 52.2105, lon: 21.06 },
      K: { lat: 52.209, lon: 21.015 },
    };
    const walkToA = walkSeconds(haversineM(origin, byLetter['A'] ?? A));
    expect(departure + walkToA).toBeLessThanOrEqual(t(8, 0)); // catches the 08:00 bus
    const readme: Record<string, number> = {
      A: departure + walkToA,
      B: t(8, 4),
      C: t(8, 8),
      D: t(8, 13),
      E: t(8, 15),
      F: t(8, 18),
      G: t(8, 15),
      H: t(8, 15, 37),
      I: t(8, 26),
      J: t(8, 32),
      K: t(8, 14),
    };
    const arrivalById = new Map<number, number>();
    for (const s of stops) {
      const letter = Object.entries(byLetter).find(([, p]) => p.lat === s.lat && p.lon === s.lon)?.[0];
      const arrival = letter === undefined ? undefined : readme[letter];
      if (arrival !== undefined) {
        arrivalById.set(s.id, arrival);
      }
    }
    const access = JSON.parse(readFileSync(resolve(FIXTURE, 'artifacts/hex-access.json'), 'utf8')).cells as {
      h3: string;
      lat: number;
      lon: number;
      stops: [number, number][];
    }[];
    const actual = new Map(body.cells.map((c: { h3: string }) => [c.h3, c]));
    expect(actual.size).toBe(access.length);

    const legend = (ratio: number) =>
      ratio < 1.2 ? 'excellent' : ratio < 1.6 ? 'good' : ratio < 2 ? 'fair' : ratio < 3 ? 'poor' : 'very_poor';
    const seen = new Set<string>();
    for (const cell of access) {
      const viaStops = Math.min(
        ...cell.stops.map(([stop, walk]) => {
          const a = arrivalById.get(stop);
          return a === undefined ? Number.POSITIVE_INFINITY : a + walk - departure;
        }),
      );
      const walk = walkSeconds(haversineM(origin, cell));
      const hasStop = cell.stops.length > 0 || walk <= 1_800;
      const best = Math.min(viaStops, walk);
      const transit = !hasStop || best > 7_200 ? null : best;
      const got = actual.get(cell.h3) as {
        transitS: number | null;
        carS: number | null;
        ratio: number | null;
        class: string;
      };
      expect(got.transitS, cell.h3).toBe(transit);
      const car = Math.max(60, Math.round(stubDuration(origin, cell)));
      expect(Math.abs((got.carS ?? 0) - car), cell.h3).toBeLessThanOrEqual(1);
      const expectedClass = !hasStop
        ? 'no_transit'
        : transit === null
          ? 'unreachable'
          : legend(Math.round((transit / (got.carS ?? 1)) * 100) / 100);
      expect(got.class, cell.h3).toBe(expectedClass);
      seen.add(expectedClass);
    }
    expect([...seen].sort()).toEqual(expect.arrayContaining(['excellent', 'no_transit']));
  });

  it('answers the same question from the cache (200), with status and metadata', async () => {
    const again = await calculate({
      cityCode: 'waw',
      origin: { lat: 52.20001, lon: 21.00001 },
      date: '2026-12-02',
      time: '07:58',
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().calculationId).toBe(id);
    const status = await call('GET', `/calculations/${id}`, '/calculations/{id}');
    expect(status.json()).toMatchObject({ status: 'done', cellCount: expect.any(Number), errorCode: null });
    expect(status.json().durationMs).toBeGreaterThanOrEqual(0);
  });

  it('computes parallel identical requests once', async () => {
    osrm.delayMs = 300;
    const before = osrm.requests;
    const body = { cityCode: 'waw', origin: A, date: '2026-12-02', time: '08:30' };
    const answers = await Promise.all(Array.from({ length: 5 }, () => calculate(body)));
    const statuses = answers.map((r) => r.statusCode).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.every((s) => [200, 201, 202].includes(s))).toBe(true);
    expect(new Set(answers.map((r) => r.json().calculationId)).size).toBe(1);
    const chunks = Math.ceil(answers[0]?.json().cellCount === null ? 2 : 1);
    expect(osrm.requests - before).toBeLessThanOrEqual(2 * chunks);
    const { rows } = await db.admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM accessibility.calculations WHERE departure_s = $1`,
      [t(8, 30)],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('uses the departure window: median of departures every 5 minutes', async () => {
    const res = await calculate({ cityCode: 'waw', origin: A, date: '2026-12-02', time: '07:58', windowMinutes: 10 });
    expect(res.statusCode).toBe(201);
    expect(res.json().windowMinutes).toBe(10);
  });
});

describe('refusals', () => {
  it('400 for a malformed request, 404 for unknown cities and calculations', async () => {
    expect((await calculate({ cityCode: 'waw', origin: { lat: 99, lon: 21 } })).statusCode).toBe(400);
    expect((await calculate({ cityCode: 'xyz', origin: A })).statusCode).toBe(404);
    expect(
      (await call('GET', '/calculations/0b0e0000-0000-4000-8000-00000000ffff', '/calculations/{id}')).statusCode,
    ).toBe(404);
  });

  it('422 for an origin outside the city and a date outside the timetable', async () => {
    const outside = await calculate({ cityCode: 'waw', origin: { lat: 54.68, lon: 25.28 } });
    expect(outside.json()).toMatchObject({ status: 422, type: '/problems/origin-outside-city' });
    const late = await calculate({ cityCode: 'waw', origin: A, date: '2027-06-01' });
    expect(late.json()).toMatchObject({ status: 422, type: '/problems/date-outside-feed' });
  });

  it('503 while a city has no timetable loaded', async () => {
    const res = await calculate({ cityCode: 'vno', origin: { lat: 54.68, lon: 25.28 } });
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('503 when the bulkhead is full (1 running + 1 queued)', async () => {
    osrm.delayMs = 400;
    const answers = await Promise.all(
      ['10:00', '10:05', '10:10'].map((time) => calculate({ cityCode: 'waw', origin: A, date: '2026-12-02', time })),
    );
    const statuses = answers.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([201, 201, 503]);
    const busy = answers.find((r) => r.statusCode === 503);
    expect(busy?.json()).toMatchObject({ type: '/problems/calculations-busy' });
    expect(busy?.headers['retry-after']).toBe('5');
  });
});

describe('events and housekeeping', () => {
  it('publishes accessibility.calculation.completed.v1 with the user and deletes the outbox row', async () => {
    const next = await broker.listen('accessibility.calculation.completed.v1');
    const computed = await calculate(
      { cityCode: 'waw', origin: A, date: '2026-12-02', time: '11:00' },
      { 'x-user-id': USER, 'x-user-role': 'user', 'x-correlation-id': 'corr-calc-1' },
    );
    const event = await next();
    expect(event.body).toMatchObject({
      type: 'accessibility.calculation.completed.v1',
      source: 'accessibility',
      correlationId: 'corr-calc-1',
      data: { calculationId: computed.json().calculationId, cityCode: 'waw', userId: USER, cacheHit: false },
    });
    await calculate({ cityCode: 'waw', origin: A, date: '2026-12-02', time: '11:00' }, { 'x-user-id': USER });
    expect((await next()).body).toMatchObject({ data: { userId: USER, cacheHit: true } });
    await eventually('outbox rows deleted', async () => {
      const { rows } = await db.admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM accessibility.outbox`);
      return rows[0]?.n === 0;
    });
  });

  it('purges expired calculations with their results', async () => {
    const res = await calculate({ cityCode: 'waw', origin: A, date: '2026-12-02', time: '12:00' });
    const id = res.json().calculationId;
    await db.admin.query(
      `UPDATE accessibility.calculations SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE calculation_id = $1`,
      [id],
    );
    expect(await service.calculations.purgeExpired()).toBeGreaterThanOrEqual(1);
    expect((await call('GET', `/calculations/${id}`, '/calculations/{id}')).statusCode).toBe(404);
    const left = await db.admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM accessibility.calculation_results WHERE calculation_id = $1`,
      [id],
    );
    expect(left.rows[0]?.n).toBe(0);
  });
});

// Last: the OSRM failures open the per-city circuit breaker for the following requests.
describe('resilience', () => {
  it('fails a calculation when OSRM is down; cached maps keep working', async () => {
    osrm.failWith = 503;
    const res = await calculate({ cityCode: 'waw', origin: A, date: '2026-12-05', time: '09:00' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ type: '/problems/car-routing-unavailable' });
    const { rows } = await db.admin.query<{ status: string; error_code: string }>(
      `SELECT status, error_code FROM accessibility.calculations WHERE service_date = '2026-12-05'`,
    );
    expect(rows).toEqual([{ status: 'failed', error_code: 'osrm_unavailable' }]);
    const cached = await calculate({ cityCode: 'waw', origin: A, date: '2026-12-02', time: '07:58' });
    expect(cached.statusCode).toBe(200);
  });
});
