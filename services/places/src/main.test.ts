import { describe, expect, it } from 'vitest';
import { loadServiceConfig } from './config.ts';
import { photonName, Throttle } from './geocoding/geocoder.ts';
import { normaliseQuery } from './usecases/geocode.ts';

describe('places', () => {
  it('stops on missing variables and defaults to Photon', () => {
    expect(() => loadServiceConfig({})).toThrow(/TRANSIT_URL: missing/);
    const config = loadServiceConfig({
      SERVICE_NAME: 'places',
      PORT: '3004',
      DATABASE_URL: 'postgres://svc_places:x@localhost/heatmap',
      AMQP_URL: 'amqp://u:p@localhost:5672',
      TRANSIT_URL: 'http://transit-data:3002',
    });
    expect(config).toMatchObject({ GEOCODER_PROVIDER: 'photon', GEOCODER_MIN_INTERVAL_MS: 1000 });
  });

  it('normalises queries for the cache', () => {
    expect(normaliseQuery('  Marszałkowska   10 ')).toBe('marszałkowska 10');
  });

  it('builds readable names from Photon address parts', () => {
    expect(
      photonName({ street: 'Gedimino prospektas', housenumber: '9', city: 'Vilnius', district: 'Senamiestis' }),
    ).toBe('Gedimino prospektas 9, Senamiestis, Vilnius');
    expect(photonName({ name: 'Palace of Culture', street: 'plac Defilad', housenumber: '1', city: 'Warsaw' })).toBe(
      'Palace of Culture, plac Defilad 1, Warsaw',
    );
  });

  it('throttles calls to the configured interval', async () => {
    const throttle = new Throttle(50);
    const started = Date.now();
    await Promise.all([throttle.wait(), throttle.wait(), throttle.wait()]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(95);
  });
});
