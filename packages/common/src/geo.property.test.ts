import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS_M, haversineM, walkSeconds } from './geo.ts';

const coordinate = (limit: number) => fc.double({ min: -limit, max: limit, noNaN: true });
/** Near the antipode the arcsine loses centimetres, so inequalities are checked at city scale. */
const cityPoint = fc.record({
  lat: fc.double({ min: 51, max: 55, noNaN: true }),
  lon: fc.double({ min: 20, max: 26, noNaN: true }),
});
const point = fc.record({ lat: coordinate(90), lon: coordinate(180) });

describe('distances and walking (properties)', () => {
  it('the distance is symmetric, zero to itself and at most half the circumference', () => {
    fc.assert(
      fc.property(point, point, (a, b) => {
        expect(haversineM(a, a)).toBe(0);
        expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 5);
        expect(haversineM(a, b)).toBeLessThanOrEqual(Math.PI * EARTH_RADIUS_M + 1);
      }),
    );
  });

  it('a detour over a third point is never shorter', () => {
    fc.assert(
      fc.property(cityPoint, cityPoint, cityPoint, (a, b, c) => {
        expect(haversineM(a, c)).toBeLessThanOrEqual(haversineM(a, b) + haversineM(b, c) + 0.001);
      }),
    );
  });

  it('walking takes whole seconds and never less for a longer way', () => {
    const meters = fc.double({ min: 0, max: 50_000, noNaN: true });
    fc.assert(
      fc.property(meters, meters, (a, b) => {
        expect(Number.isInteger(walkSeconds(a))).toBe(true);
        expect(walkSeconds(Math.min(a, b))).toBeLessThanOrEqual(walkSeconds(Math.max(a, b)));
      }),
    );
  });
});
