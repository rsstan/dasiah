import { describe, expect, it } from 'vitest';
import { UNREACHED } from '../raptor/raptor.ts';
import { buildTimetable } from '../raptor/timetable.ts';
import type { HexCells } from '../timetables/store.ts';
import { cellTimes, HORIZON_S, medianTimes, WALK_ONLY_LIMIT_S } from './cells.ts';

const ORIGIN = { lat: 52, lon: 21 };
const DEPARTURE = 28_800;
/** Two stops with artifact ids 10 and 20 (indexes 0 and 1); no trips are needed here. */
const timetable = buildTimetable({
  version: 1,
  feedVersionId: 1,
  date: '2026-11-24',
  stops: [
    { id: 10, lat: 52, lon: 21 },
    { id: 20, lat: 52, lon: 21 },
  ],
  transfers: [],
  patterns: [],
});

/** Cells `km` north of the origin with access stops [stopId, walkS][]. */
function cells(...list: { km: number; stops: [number, number][] }[]): HexCells {
  const flat = list.flatMap((c) => c.stops);
  let at = 0;
  return {
    resolution: 9,
    count: list.length,
    h3: list.map((_, i) => `cell-${i}`),
    lat: Float64Array.from(list, (c) => ORIGIN.lat + c.km / 111.195),
    lon: Float64Array.from(list, () => ORIGIN.lon),
    accessStart: Int32Array.from([0, ...list.map((c) => (at += c.stops.length))]),
    accessStop: Int32Array.from(flat, ([s]) => s),
    accessWalk: Int32Array.from(flat, ([, w]) => w),
  };
}

const run = (c: HexCells, arrival: number[]) => cellTimes(c, timetable, Int32Array.from(arrival), ORIGIN, DEPARTURE);

describe('cell times', () => {
  it('takes the best access stop: arrival plus walk minus departure', () => {
    const r = run(
      cells({
        km: 20,
        stops: [
          [10, 300],
          [20, 60],
        ],
      }),
      [DEPARTURE + 600, DEPARTURE + 700],
    );
    expect(r).toEqual({ transitS: [760], hasStop: [true] });
  });

  it('walks when that is faster than riding', () => {
    const r = run(cells({ km: 0.5, stops: [[10, 60]] }), [DEPARTURE + 3_000, UNREACHED]);
    expect(r.transitS[0]).toBeGreaterThan(450); // 500 m x 1.3 at 5 km/h is about 468 s
    expect(r.transitS[0]).toBeLessThan(480);
  });

  it('has no time, but a stop, when nothing is reached within the horizon', () => {
    const far = cells({ km: 20, stops: [[10, 100]] });
    expect(run(far, [UNREACHED, UNREACHED])).toEqual({ transitS: [null], hasStop: [true] });
    const at = (s: number) => run(far, [DEPARTURE + s, UNREACHED]).transitS[0];
    expect(at(HORIZON_S - 100)).toBe(HORIZON_S); // exactly two hours still counts
    expect(at(HORIZON_S - 99)).toBeNull();
  });

  it('without a stop nearby only a walk of up to 30 minutes counts', () => {
    const r = run(cells({ km: 1.9, stops: [] }, { km: 2, stops: [] }), [UNREACHED, UNREACHED]);
    expect(r.hasStop).toEqual([true, false]);
    expect(r.transitS[0]).toBeLessThanOrEqual(WALK_ONLY_LIMIT_S);
    expect(r.transitS[1]).toBeNull();
  });

  it('counts a walk of exactly 30 minutes', () => {
    // The walking time grows by whole seconds: find the last distance that takes 1 800 s.
    const seconds = (km: number) => run(cells({ km, stops: [[99, 0]] }), [UNREACHED, UNREACHED]).transitS[0] ?? 0;
    let km = 1.9;
    while (seconds(km + 0.0005) <= WALK_ONLY_LIMIT_S) {
      km += 0.0005;
    }
    expect(seconds(km)).toBe(WALK_ONLY_LIMIT_S);
    expect(run(cells({ km, stops: [] }), [UNREACHED, UNREACHED])).toEqual({
      transitS: [WALK_ONLY_LIMIT_S],
      hasStop: [true],
    });
  });

  it('keeps the stops of neighbouring cells apart', () => {
    const r = run(cells({ km: 20, stops: [[10, 10]] }, { km: 20, stops: [[20, 10]] }), [UNREACHED, DEPARTURE + 60]);
    expect(r).toEqual({ transitS: [null, 70], hasStop: [true, true] });
  });

  it('ignores an access stop the timetable does not know', () => {
    expect(run(cells({ km: 20, stops: [[99, 10]] }), [DEPARTURE, DEPARTURE])).toEqual({
      transitS: [null],
      hasStop: [true],
    });
  });
});

describe('median over departures', () => {
  it('takes the middle value, the lower one of an even number', () => {
    expect(medianTimes([[900], [300], [600]])).toEqual([600]);
    expect(medianTimes([[900], [300]])).toEqual([300]);
    expect(medianTimes([[300, null]])).toEqual([300, null]);
  });

  it('treats unreachable as worse than everything', () => {
    expect(medianTimes([[null], [300], [null]])).toEqual([null]);
    expect(medianTimes([[null], [300], [600]])).toEqual([600]);
  });

  it('is empty without runs', () => {
    expect(medianTimes([])).toEqual([]);
  });
});
