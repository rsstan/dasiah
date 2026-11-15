// From stop arrivals to cell times (docs/05-algorithms.md#6):
//   transit(c)   = min over access stops s of c of (arr[s] + walk(c, s)) - departure
//   walk(c)      = walkSeconds(haversine(origin, centre(c)))
//   t_transit(c) = min(transit(c), walk(c)); null above the horizon
// A cell without access stops is `has_stop = false` (legend: no transit) unless walking alone
// takes at most 1 800 s, in which case walking is its time.
import { haversineM, walkSeconds } from '@heatmap/common';
import { UNREACHED } from '../raptor/raptor.ts';
import type { Timetable } from '../raptor/timetable.ts';
import type { HexCells } from '../timetables/store.ts';

export const HORIZON_S = 7_200;
export const WALK_ONLY_LIMIT_S = 1_800;

export interface CellTimes {
  /** Seconds door to door, null = not reachable within the horizon. */
  readonly transitS: (number | null)[];
  readonly hasStop: boolean[];
}

export function cellTimes(
  cells: HexCells,
  timetable: Timetable,
  arrival: Int32Array,
  origin: { lat: number; lon: number },
  departureS: number,
): CellTimes {
  const transitS: (number | null)[] = new Array<number | null>(cells.count).fill(null);
  const hasStop: boolean[] = new Array<boolean>(cells.count).fill(false);
  for (let c = 0; c < cells.count; c++) {
    let best = Number.POSITIVE_INFINITY;
    const from = cells.accessStart[c] ?? 0;
    const to = cells.accessStart[c + 1] ?? 0;
    for (let j = from; j < to; j++) {
      const s = timetable.stopIndex.get(cells.accessStop[j] ?? -1);
      const a = s === undefined ? UNREACHED : (arrival[s] ?? UNREACHED);
      if (a !== UNREACHED) {
        best = Math.min(best, a + (cells.accessWalk[j] ?? 0) - departureS);
      }
    }
    const walk = walkSeconds(haversineM(origin, { lat: cells.lat[c] ?? 0, lon: cells.lon[c] ?? 0 }));
    const hasAccess = to > from;
    if (!hasAccess && walk > WALK_ONLY_LIMIT_S) {
      continue; // no transit: has_stop false, time null
    }
    hasStop[c] = true;
    const t = Math.min(best, walk);
    transitS[c] = t <= HORIZON_S ? t : null;
  }
  return { transitS, hasStop };
}

/** Median per cell over several departures (null counts as "worse than everything"). */
export function medianTimes(runs: readonly (readonly (number | null)[])[]): (number | null)[] {
  const first = runs[0];
  if (first === undefined) {
    return [];
  }
  return first.map((_, c) => {
    const values = runs.map((r) => r[c] ?? null).map((v) => (v === null ? Number.POSITIVE_INFINITY : v));
    values.sort((a, b) => a - b);
    const mid = values[Math.floor((values.length - 1) / 2)] ?? Number.POSITIVE_INFINITY;
    return Number.isFinite(mid) ? mid : null;
  });
}
