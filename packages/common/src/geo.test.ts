import { describe, expect, it } from 'vitest';
import { haversineM, walkSeconds } from './geo.ts';

describe('walking model', () => {
  it('matches transit.walk_seconds of the database within a second (testville D -> H)', () => {
    // PostGIS (spheroid): 166.9 m, walk_seconds 157.
    const meters = haversineM({ lat: 52.2, lon: 21.045 }, { lat: 52.2015, lon: 21.045 });
    expect(meters).toBeCloseTo(166.8, 0);
    expect(Math.abs(walkSeconds(meters) - 157)).toBeLessThanOrEqual(1);
  });

  it('is 1.3 x distance at 5 km/h, rounded up', () => {
    expect(walkSeconds(0)).toBe(0);
    expect(walkSeconds(1_000)).toBe(936); // 1 300 m / 1.389 m/s = 935.9
    expect(walkSeconds(1_500)).toBe(1_404);
  });

  it('measures about 1 km between testville stops on a line', () => {
    expect(haversineM({ lat: 52.2, lon: 21.0 }, { lat: 52.2, lon: 21.015 })).toBeCloseTo(1_023, -1);
  });
});
