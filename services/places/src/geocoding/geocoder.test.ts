import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { captureLogger } from '@heatmap/common/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normaliseQuery } from '../usecases/geocode.ts';
import { NominatimGeocoder, photonName, PhotonGeocoder, Throttle } from './geocoder.ts';

const BOUNDS = { west: 20.8, south: 52.1, east: 21.3, north: 52.4 };
const OPTIONS = { minIntervalMs: 0, timeoutMs: 2_000 };
let server: Server | undefined;
let asked: (URL & { agent?: string | undefined })[] = [];

/** A geocoder that answers `body`; returns its base URL. */
async function provider(body: unknown): Promise<string> {
  asked = [];
  server = createServer((req, res) => {
    asked.push(Object.assign(new URL(req.url ?? '/', 'http://x'), { agent: req.headers['user-agent'] }));
    res.setHeader('content-type', 'application/json').end(JSON.stringify(body));
  });
  await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  vi.useRealTimers();
  await new Promise<void>((r) => (server === undefined ? r() : server.close(() => r())));
  server = undefined;
});

const { logger } = captureLogger('geocoder');
const feature = (lon: number | undefined, lat: number | undefined, properties: Record<string, string>) => ({
  geometry: { coordinates: lon === undefined ? undefined : [lon, lat] },
  properties,
});

describe('names of Photon results', () => {
  it.each([
    ['street with number', { street: 'Prosta', housenumber: '12', city: 'Warszawa' }, 'Prosta 12, Warszawa'],
    ['a place on a street', { name: 'Museum', street: 'Prosta', city: 'Warszawa' }, 'Museum, Prosta, Warszawa'],
    ['a street named as itself', { name: 'Prosta', street: 'Prosta', city: 'Warszawa' }, 'Prosta, Warszawa'],
    ['a place without a street', { name: 'Old Town', city: 'Warszawa' }, 'Old Town, Warszawa'],
    ['district before locality', { name: 'X', district: 'Wola', locality: 'Mirow' }, 'X, Wola'],
    ['locality when there is no district', { name: 'X', locality: 'Mirow' }, 'X, Mirow'],
    ['no part twice', { name: 'Warszawa', city: 'Warszawa' }, 'Warszawa'],
    ['nothing known', {}, ''],
    ['empty parts', { name: '', city: 'Warszawa' }, 'Warszawa'],
  ])('%s', (_, properties, expected) => {
    expect(photonName(properties)).toBe(expected);
  });
});

describe('Photon', () => {
  it('asks inside the city and keeps usable results inside it, up to the limit', async () => {
    const url = await provider({
      features: [
        feature(21.0, 52.2, { name: 'A' }),
        feature(25.2, 54.6, { name: 'Vilnius' }), // outside
        feature(21.0, 52.2, {}), // no name
        feature(undefined, undefined, { name: 'no point' }),
        { properties: { name: 'no geometry' } },
        feature(BOUNDS.west, BOUNDS.north, { name: 'corner' }),
        feature(21.1, 52.3, { name: 'too many' }),
      ],
    });
    const found = await new PhotonGeocoder(url, logger, OPTIONS).search('a b', BOUNDS, 2);
    expect(found).toEqual([
      { displayName: 'A', lat: 52.2, lon: 21 },
      { displayName: 'corner', lat: 52.4, lon: 20.8 },
    ]);
    expect(Object.fromEntries(asked[0]?.searchParams ?? [])).toEqual({
      q: 'a b',
      limit: '2',
      bbox: '20.8,52.1,21.3,52.4',
    });
  });

  it('keeps points on the border of the city and drops points just outside any side', async () => {
    const on: [number, number][] = [
      [BOUNDS.west, 52.2],
      [BOUNDS.east, 52.2],
      [21, BOUNDS.south],
      [21, BOUNDS.north],
    ];
    const off: [number, number][] = [
      [BOUNDS.west - 0.001, 52.2],
      [BOUNDS.east + 0.001, 52.2],
      [21, BOUNDS.south - 0.001],
      [21, BOUNDS.north + 0.001],
    ];
    const url = await provider({
      features: [...on, ...off].map(([lon, lat], i) => feature(lon, lat, { name: `${i}` })),
    });
    const found = await new PhotonGeocoder(url, logger, OPTIONS).search('x', BOUNDS, 10);
    expect(found.map((c) => c.displayName)).toEqual(['0', '1', '2', '3']);
    expect(asked[0]).toMatchObject({ pathname: '/api', agent: 'transit-heatmap/1.0' });
  });

  it('finds nothing in an answer without features', async () => {
    expect(await new PhotonGeocoder(await provider({}), logger, OPTIONS).search('x', BOUNDS, 5)).toEqual([]);
  });
});

describe('Nominatim', () => {
  it('reads coordinates from text and drops results outside the city or without a number', async () => {
    const url = await provider([
      { display_name: 'A', lat: '52.2', lon: '21.0' },
      { display_name: 'far', lat: '54.6', lon: '25.2' },
      { display_name: 'broken', lat: 'n/a', lon: '21.0' },
      { display_name: 'broken too', lat: '52.2', lon: 'n/a' },
    ]);
    const found = await new NominatimGeocoder(url, logger, OPTIONS).search('x', BOUNDS, 5);
    expect(found).toEqual([{ displayName: 'A', lat: 52.2, lon: 21 }]);
    expect(asked[0]).toMatchObject({ pathname: '/search', agent: 'transit-heatmap/1.0' });
    expect(asked[0]?.searchParams.get('format')).toBe('jsonv2');
    expect(asked[0]?.searchParams.get('viewbox')).toBe('20.8,52.4,21.3,52.1');
    expect(asked[0]?.searchParams.get('bounded')).toBe('1');
  });
});

describe('throttle', () => {
  it('lets the first call through at once and spaces the next ones', async () => {
    vi.useFakeTimers();
    const throttle = new Throttle(1_000);
    const passed: number[] = [];
    const start = Date.now();
    const call = () => throttle.wait().then(() => passed.push(Date.now() - start));
    void call();
    void call();
    void call();
    await vi.advanceTimersByTimeAsync(0);
    expect(passed).toEqual([0]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(passed).toEqual([0, 1_000, 2_000]);
  });

  it('does not save up unused time', async () => {
    vi.useFakeTimers();
    const throttle = new Throttle(1_000);
    await throttle.wait();
    await vi.advanceTimersByTimeAsync(10_000);
    await throttle.wait(); // free again
    const second = vi.fn();
    void throttle.wait().then(second);
    await vi.advanceTimersByTimeAsync(999);
    expect(second).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(second).toHaveBeenCalledOnce();
  });
});

describe('cache key of a query', () => {
  it('ignores case, outer and repeated whitespace', () => {
    expect(normaliseQuery('  Prosta \t 12  ')).toBe('prosta 12');
    expect(normaliseQuery('ŻÓŁĆ')).toBe('żółć');
  });
});
