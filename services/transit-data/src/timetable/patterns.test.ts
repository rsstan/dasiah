import { describe, expect, it } from 'vitest';
import { buildPatterns, type TripTimes } from './patterns.ts';

const t = (h: number, m: number) => h * 3600 + m * 60;
/** A trip of route 1 over stops 1..5 starting at `start` with offsets in minutes [arr, dep]. */
const trip = (start: number, offsets: [number, number][], routeId = 1, stops = [1, 2, 3, 4, 5]): TripTimes => ({
  routeId,
  stops,
  times: offsets.flatMap(([a, d]) => [start + a * 60, start + d * 60]),
});
const normal: [number, number][] = [
  [0, 0],
  [4, 4],
  [8, 9],
  [13, 13],
  [17, 17],
];
const slow: [number, number][] = [
  [0, 0],
  [6, 6],
  [12, 13],
  [25, 25],
  [30, 30],
];

describe('buildPatterns', () => {
  it('groups trips by route and stop sequence, sorted by first departure', () => {
    const patterns = buildPatterns([
      trip(t(8, 40), normal),
      trip(t(8, 0), normal),
      trip(
        t(8, 5),
        [
          [0, 0],
          [5, 5],
          [10, 10],
        ],
        2,
        [1, 3, 5],
      ),
    ]);
    expect(patterns.map((p) => [p.routeId, p.stops, p.trips.map((x) => x[1])])).toEqual([
      [1, [1, 2, 3, 4, 5], [t(8, 0), t(8, 40)]],
      [2, [1, 3, 5], [t(8, 5)]],
    ]);
  });

  it('splits a pattern when a later trip overtakes an earlier one (testville R1 east)', () => {
    const patterns = buildPatterns([
      trip(t(8, 0), normal),
      trip(t(8, 15), slow),
      trip(t(8, 20), normal),
      trip(t(8, 40), normal),
      trip(t(23, 50), normal),
    ]);
    expect(patterns).toHaveLength(2);
    expect(patterns.map((p) => p.trips.map((x) => x[1]))).toEqual([
      [t(8, 0), t(8, 15), t(8, 40), t(23, 50)],
      [t(8, 20)],
    ]);
    for (const p of patterns) {
      for (let i = 1; i < p.trips.length; i++) {
        const prev = p.trips[i - 1] ?? [];
        expect(p.trips[i]?.every((v, k) => v >= (prev[k] ?? 0))).toBe(true);
      }
    }
  });

  it('keeps a circular route (first stop equals last) and drops one-stop trips', () => {
    const circle = trip(
      t(8, 10),
      [
        [0, 0],
        [4, 4],
        [8, 8],
        [12, 12],
        [16, 16],
      ],
      4,
      [2, 11, 6, 3, 2],
    );
    const patterns = buildPatterns([circle, { routeId: 9, stops: [7], times: [t(9, 0), t(9, 0)] }]);
    expect(patterns).toEqual([{ routeId: 4, stops: [2, 11, 6, 3, 2], trips: [circle.times] }]);
  });

  it('accepts negative times of a previous-day trip running after midnight', () => {
    const night = trip(t(23, 50) - 86_400, normal);
    const [pattern] = buildPatterns([trip(t(8, 0), normal), night]);
    expect(pattern?.trips[0]?.[0]).toBe(-600);
    expect(pattern?.trips[0]?.at(-1)).toBe(420); // 00:07
  });
});
