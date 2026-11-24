import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildPatterns, type TripTimes } from './patterns.ts';

/** Trips over few routes and stop sequences, so groups and overtaking are frequent. */
const tripArb: fc.Arbitrary<TripTimes> = fc
  .record({
    routeId: fc.integer({ min: 1, max: 2 }),
    stops: fc.constantFrom([1, 2, 3], [3, 2, 1], [1, 2, 1], [5]),
    start: fc.integer({ min: -3_600, max: 3_600 }),
    steps: fc.array(fc.integer({ min: 0, max: 900 }), { minLength: 6, maxLength: 6 }),
  })
  .map(({ routeId, stops, start, steps }) => {
    let clock = start;
    return {
      routeId,
      stops,
      times: stops.flatMap((_, i) => [(clock += steps[i * 2] ?? 0), (clock += steps[i * 2 + 1] ?? 0)]),
    };
  });
const tripsArb = fc.array(tripArb, { maxLength: 25 });
const sorted = (list: readonly unknown[]) => list.map((x) => JSON.stringify(x)).sort();

describe('buildPatterns (properties)', () => {
  it('keeps every trip of two or more stops exactly once, with its route and stops', () => {
    fc.assert(
      fc.property(tripsArb, (trips) => {
        const out = buildPatterns(trips).flatMap((p) =>
          p.trips.map((times) => ({ routeId: p.routeId, stops: p.stops, times })),
        );
        expect(sorted(out)).toEqual(sorted(trips.filter((t) => t.stops.length > 1)));
      }),
    );
  });

  it('no trip of a pattern overtakes the one before it', () => {
    fc.assert(
      fc.property(tripsArb, (trips) => {
        for (const { trips: lane } of buildPatterns(trips)) {
          lane.slice(1).forEach((later, i) => {
            expect(later.every((t, k) => t >= (lane[i]?.[k] ?? 0))).toBe(true);
          });
        }
      }),
    );
  });

  it('does not depend on the order of different trips', () => {
    const distinct = fc.uniqueArray(tripArb, { maxLength: 15, selector: (t) => `${t.times[1]}|${t.times.at(-1)}` });
    fc.assert(
      fc.property(distinct, (trips) => {
        expect(buildPatterns([...trips].reverse())).toEqual(buildPatterns(trips));
      }),
    );
  });
});
