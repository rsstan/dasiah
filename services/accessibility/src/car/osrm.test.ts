import { captureLogger } from '@heatmap/common/testing';
import { ServiceUnavailableError } from '@heatmap/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startOsrmStub, stubDuration, type OsrmStub } from '../test-support/osrm-stub.ts';
import { OsrmClient } from './osrm.ts';
import { decodePolyline, encodePolyline } from './polyline.ts';

let stub: OsrmStub;
beforeAll(async () => {
  stub = await startOsrmStub();
});
afterAll(() => stub.close());
beforeEach(() => {
  stub.requests = 0;
  stub.failWith = undefined;
  stub.noRoute.clear();
});

const origin = { lat: 54.687, lon: 25.28 };
function grid(n: number): { lat: Float64Array; lon: Float64Array } {
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lat[i] = 54.6 + (i % 40) * 0.005;
    lon[i] = 25.1 + Math.floor(i / 40) * 0.008;
  }
  return { lat, lon };
}

describe('polyline', () => {
  it('round-trips at 5 decimals (the classic example)', () => {
    const points: [number, number][] = [
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ];
    expect(encodePolyline(points)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline(encodePolyline(points))).toEqual(points);
  });
});

describe('OsrmClient', () => {
  it('splits the destinations into chunks and keeps the order', async () => {
    const { lat, lon } = grid(1_234);
    const client = new OsrmClient('vno', stub.url, captureLogger().logger, { chunkSize: 500, parallel: 3 });
    const times = await client.carTimes(origin, lat, lon);
    expect(stub.requests).toBe(3);
    expect(times).toHaveLength(1_234);
    for (const i of [0, 499, 500, 1_233]) {
      // The stub sees coordinates rounded to 5 decimals by the polyline.
      const expected = Math.round(stubDuration(origin, { lat: lat[i] ?? 0, lon: lon[i] ?? 0 }));
      expect(Math.abs((times[i] ?? 0) - expected)).toBeLessThanOrEqual(1);
    }
  });

  it('applies factor, overhead and the 60 s minimum; keeps null for no road', async () => {
    const lat = Float64Array.from([origin.lat, 54.75]);
    const lon = Float64Array.from([origin.lon, 25.4]);
    stub.noRoute.add(1);
    const plain = await new OsrmClient('vno', stub.url, captureLogger().logger).carTimes(origin, lat, lon);
    expect(plain).toEqual([60, null]);
    const lat2 = Float64Array.from([54.75]);
    const lon2 = Float64Array.from([25.4]);
    stub.noRoute.clear();
    const base = (await new OsrmClient('vno', stub.url, captureLogger().logger).carTimes(origin, lat2, lon2))[0] ?? 0;
    const tuned = await new OsrmClient('vno', stub.url, captureLogger().logger, {
      factor: 1.5,
      overheadS: 120,
    }).carTimes(origin, lat2, lon2);
    expect(Math.abs((tuned[0] ?? 0) - (Math.round(base * 1.5) + 120))).toBeLessThanOrEqual(1);
  });

  it('fails the whole result when OSRM fails, and opens its breaker', async () => {
    const { lat, lon } = grid(50);
    stub.failWith = 503;
    const client = new OsrmClient('vno', stub.url, captureLogger().logger, { timeoutMs: 500 });
    for (let i = 0; i < 2; i++) {
      await expect(client.carTimes(origin, lat, lon)).rejects.toBeInstanceOf(ServiceUnavailableError);
    }
    expect(client.circuitState).not.toBe('0'); // 5 failed attempts in a row: open
    const before = stub.requests;
    await expect(client.carTimes(origin, lat, lon)).rejects.toThrow(/circuit open/);
    expect(stub.requests).toBe(before);
  });

  it('refuses a malformed answer', async () => {
    stub.failWith = 400;
    const { lat, lon } = grid(3);
    await expect(new OsrmClient('vno', stub.url, captureLogger().logger).carTimes(origin, lat, lon)).rejects.toThrow(
      /OSRM vno answered 400/,
    );
  });
});

describe('pacing', () => {
  it('spaces table requests by minIntervalMs, also across parallel workers', async () => {
    const { lat, lon } = grid(1_200);
    const client = new OsrmClient('vno', stub.url, captureLogger().logger, {
      chunkSize: 400,
      parallel: 3,
      minIntervalMs: 80,
    });
    const started = Date.now();
    await client.carTimes(origin, lat, lon);
    expect(stub.requests).toBe(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(160);
  });
});
