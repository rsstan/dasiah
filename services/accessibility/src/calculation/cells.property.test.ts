import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { medianTimes } from './cells.ts';

const time = fc.option(fc.integer({ min: 0, max: 7_200 }), { nil: null });
const runsArb = fc
  .record({ cells: fc.integer({ min: 1, max: 5 }), runs: fc.integer({ min: 1, max: 13 }) })
  .chain(({ cells, runs }) =>
    fc.array(fc.array(time, { minLength: cells, maxLength: cells }), { minLength: runs, maxLength: runs }),
  );

describe('median over departures (properties)', () => {
  it('does not depend on the order of the departures', () => {
    fc.assert(
      fc.property(runsArb, (runs) => {
        expect(medianTimes([...runs].reverse())).toEqual(medianTimes(runs));
      }),
    );
  });

  it('is one of the values, with at least half of them not better and half not worse', () => {
    fc.assert(
      fc.property(runsArb, (runs) => {
        medianTimes(runs).forEach((median, c) => {
          const worst = (v: number | null | undefined) => v ?? Number.POSITIVE_INFINITY;
          const values = runs.map((r) => worst(r[c]));
          expect(values).toContain(worst(median));
          expect(values.filter((v) => v <= worst(median)).length * 2).toBeGreaterThanOrEqual(values.length);
          expect(values.filter((v) => v >= worst(median)).length * 2).toBeGreaterThanOrEqual(values.length);
        });
      }),
    );
  });
});
