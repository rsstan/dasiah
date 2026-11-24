// RAPTOR (Delling, Pajor, Werneck 2012), one-to-all earliest arrival, as in
// docs/05-algorithms.md#6:
//   round 0: walk from the origin to stops within the access radius;
//   round k: scan every pattern through a stop improved in round k-1 from its earliest such
//   position, riding the earliest trip that can be caught there (binary search; patterns never
//   overtake), then relax one footpath hop from the stops improved by riding;
//   stop after K rounds (K - 1 transfers) or when nothing improves.
// Boarding needs departure >= arrival (no minimum transfer time). Arrivals later than
// departure + horizon are ignored.
import { haversineM, walkSeconds } from '@heatmap/common';
import { candidateStops, type Timetable } from './timetable.ts';

export const UNREACHED = 2_147_483_647;

export interface RaptorOptions {
  /** Rounds, i.e. trips; K - 1 transfers. Default 5. */
  readonly maxRounds?: number;
  /** Seconds after departure beyond which nothing is explored. Default 7 200. */
  readonly horizonS?: number;
  /** Walking radius from the origin to the first stop, metres. Default 1 000. */
  readonly accessRadiusM?: number;
}

export interface Origin {
  readonly lat: number;
  readonly lon: number;
}

export interface RaptorResult {
  /** Earliest arrival (seconds of the service day) per stop index; UNREACHED if none. */
  readonly arrival: Int32Array;
  readonly rounds: number;
}

/** Stops within `radiusM` of a point with their walking time. */
export function stopsNear(timetable: Timetable, point: Origin, radiusM: number): { stop: number; walkS: number }[] {
  const near: { stop: number; walkS: number }[] = [];
  for (const s of candidateStops(timetable, point.lat, point.lon, radiusM)) {
    const meters = haversineM(point, { lat: timetable.stopLat[s] ?? 0, lon: timetable.stopLon[s] ?? 0 });
    if (meters <= radiusM) {
      near.push({ stop: s, walkS: walkSeconds(meters) });
    }
  }
  return near;
}

/** Index of the earliest trip of pattern `p` departing at position `pos` at or after `time`, or -1. */
function earliestTrip(tt: Timetable, p: number, pos: number, time: number): number {
  const n = (tt.patternStopStart[p + 1] ?? 0) - (tt.patternStopStart[p] ?? 0);
  const base = (tt.patternTimeStart[p] ?? 0) + pos * 2 + 1;
  let lo = 0;
  let hi = (tt.patternTripCount[p] ?? 0) - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if ((tt.stopTimes[base + mid * n * 2] ?? 0) >= time) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return found;
}

export function raptor(tt: Timetable, origin: Origin, departureS: number, options: RaptorOptions = {}): RaptorResult {
  const maxRounds = options.maxRounds ?? 5;
  const limit = departureS + (options.horizonS ?? 7_200);
  const S = tt.stopCount;
  const best = new Int32Array(S).fill(UNREACHED);
  const previous = new Int32Array(S);
  const markedNow = new Uint8Array(S);
  let marked: number[] = [];

  for (const { stop, walkS } of stopsNear(tt, origin, options.accessRadiusM ?? 1_000)) {
    const t = departureS + walkS;
    if (t < (best[stop] ?? UNREACHED) && t <= limit) {
      best[stop] = t;
      if (markedNow[stop] === 0) {
        markedNow[stop] = 1;
        marked.push(stop);
      }
    }
  }

  const patternFrom = new Int32Array(tt.patternCount).fill(-1);
  let rounds = 0;
  for (let k = 1; k <= maxRounds && marked.length > 0; k++) {
    rounds = k;
    previous.set(best); // arrivals with at most k - 1 trips
    // Collect patterns through marked stops with the earliest marked position.
    const queue: number[] = [];
    for (const s of marked) {
      markedNow[s] = 0;
      for (let j = tt.stopPatternStart[s] ?? 0; j < (tt.stopPatternStart[s + 1] ?? 0); j++) {
        const p = tt.stopPatternIds[j] ?? 0;
        const pos = tt.stopPatternPos[j] ?? 0;
        const current = patternFrom[p] ?? -1;
        if (current === -1) {
          queue.push(p);
          patternFrom[p] = pos;
        } else if (pos < current) {
          patternFrom[p] = pos;
        }
      }
    }
    marked = [];

    for (const p of queue) {
      const from = patternFrom[p] ?? 0;
      patternFrom[p] = -1;
      const s0 = tt.patternStopStart[p] ?? 0;
      const n = (tt.patternStopStart[p + 1] ?? 0) - s0;
      const t0 = tt.patternTimeStart[p] ?? 0;
      let trip = -1;
      for (let i = from; i < n; i++) {
        const s = tt.patternStops[s0 + i] ?? 0;
        if (trip !== -1) {
          const arrival = tt.stopTimes[t0 + (trip * n + i) * 2] ?? UNREACHED;
          if (arrival < (best[s] ?? UNREACHED) && arrival <= limit) {
            best[s] = arrival;
            if (markedNow[s] === 0) {
              markedNow[s] = 1;
              marked.push(s);
            }
          }
        }
        // Can an earlier trip be caught here with at most k - 1 trips so far?
        const ready = previous[s] ?? UNREACHED;
        if (ready !== UNREACHED && (trip === -1 || ready <= (tt.stopTimes[t0 + (trip * n + i) * 2 + 1] ?? 0))) {
          const earlier = earliestTrip(tt, p, i, ready);
          if (earlier !== -1 && (trip === -1 || earlier < trip)) {
            trip = earlier;
          }
        }
      }
    }

    // One footpath hop from the stops improved by riding in this round, starting at the arrival by
    // trip: read all of them first, since a hop may improve another of these stops and walking on
    // from there would be a second hop.
    const rode = marked.map((s) => [s, best[s] ?? UNREACHED] as const);
    for (const [s, from] of rode) {
      for (let j = tt.transferStart[s] ?? 0; j < (tt.transferStart[s + 1] ?? 0); j++) {
        const to = tt.transferTo[j] ?? 0;
        const t = from + (tt.transferWalk[j] ?? 0);
        if (t < (best[to] ?? UNREACHED) && t <= limit) {
          best[to] = t;
          if (markedNow[to] === 0) {
            markedNow[to] = 1;
            marked.push(to);
          }
        }
      }
    }
  }
  return { arrival: best, rounds };
}
