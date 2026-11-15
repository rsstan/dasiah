// In-memory timetable for RAPTOR, built once per (feed version, date) from the artifact of
// transit-data (docs/05-algorithms.md#4). Everything is in typed arrays indexed by dense
// internal numbers: stop index 0..S-1, pattern index 0..P-1.

export interface TimetableArtifact {
  readonly version: 1;
  readonly feedVersionId: number;
  readonly date: string;
  readonly stops: readonly { readonly id: number; readonly lat: number; readonly lon: number }[];
  /** [fromStopId, toStopId, walkS] */
  readonly transfers: readonly (readonly [number, number, number])[];
  readonly patterns: readonly {
    readonly routeId: number;
    readonly stops: readonly number[];
    /** One array per trip: [arr0, dep0, arr1, dep1, ...]; trips never overtake. */
    readonly trips: readonly (readonly number[])[];
  }[];
}

export interface Timetable {
  readonly feedVersionId: number;
  readonly date: string;
  readonly stopCount: number;
  /** Artifact stop id of each stop index. */
  readonly stopIds: Int32Array;
  /** Stop index of an artifact stop id. */
  readonly stopIndex: ReadonlyMap<number, number>;
  readonly stopLat: Float64Array;
  readonly stopLon: Float64Array;

  readonly patternCount: number;
  readonly patternRoute: Int32Array;
  /** Stops of pattern p: patternStops[patternStopStart[p] .. patternStopStart[p + 1]). */
  readonly patternStopStart: Int32Array;
  readonly patternStops: Int32Array;
  readonly patternTripCount: Int32Array;
  /**
   * Times of pattern p, trip t, position i: arrival at stopTimes[patternTimeStart[p] + (t * n + i) * 2],
   * departure at the next element, with n = number of stops of p.
   */
  readonly patternTimeStart: Int32Array;
  readonly stopTimes: Int32Array;

  /** Patterns serving stop s and the position in each: [stopPatternStart[s] .. stopPatternStart[s + 1]). */
  readonly stopPatternStart: Int32Array;
  readonly stopPatternIds: Int32Array;
  readonly stopPatternPos: Int32Array;

  /** Footpaths from stop s: [transferStart[s] .. transferStart[s + 1]). */
  readonly transferStart: Int32Array;
  readonly transferTo: Int32Array;
  readonly transferWalk: Int32Array;

  readonly grid: StopGrid;
}

/** Equal-angle buckets of about 1 km for "stops within a radius". */
export interface StopGrid {
  readonly cellDeg: number;
  readonly buckets: ReadonlyMap<string, readonly number[]>;
}

const GRID_DEG = 0.01;
const bucketKey = (lat: number, lon: number): string => `${Math.floor(lat / GRID_DEG)}:${Math.floor(lon / GRID_DEG)}`;

function csr(count: number, entries: readonly (readonly [number, ...number[]])[], width: number): Int32Array[] {
  const start = new Int32Array(count + 1);
  for (const [owner] of entries) {
    start[owner + 1] = (start[owner + 1] ?? 0) + 1;
  }
  for (let i = 0; i < count; i++) {
    start[i + 1] = (start[i + 1] ?? 0) + (start[i] ?? 0);
  }
  const columns = Array.from({ length: width }, () => new Int32Array(entries.length));
  const fill = start.slice(0, count);
  for (const [owner, ...values] of entries) {
    const at = fill[owner] ?? 0;
    fill[owner] = at + 1;
    values.forEach((v, c) => {
      const column = columns[c];
      if (column !== undefined) {
        column[at] = v;
      }
    });
  }
  return [start, ...columns];
}

export function buildTimetable(artifact: TimetableArtifact): Timetable {
  const stopCount = artifact.stops.length;
  const stopIds = new Int32Array(stopCount);
  const stopLat = new Float64Array(stopCount);
  const stopLon = new Float64Array(stopCount);
  const stopIndex = new Map<number, number>();
  const buckets = new Map<string, number[]>();
  artifact.stops.forEach((s, i) => {
    stopIds[i] = s.id;
    stopLat[i] = s.lat;
    stopLon[i] = s.lon;
    stopIndex.set(s.id, i);
    const key = bucketKey(s.lat, s.lon);
    const list = buckets.get(key);
    if (list === undefined) {
      buckets.set(key, [i]);
    } else {
      list.push(i);
    }
  });
  const index = (id: number): number => {
    const i = stopIndex.get(id);
    if (i === undefined) {
      throw new Error(`timetable refers to unknown stop ${id}`);
    }
    return i;
  };

  const patternCount = artifact.patterns.length;
  const patternRoute = new Int32Array(patternCount);
  const patternStopStart = new Int32Array(patternCount + 1);
  const patternTripCount = new Int32Array(patternCount);
  const patternTimeStart = new Int32Array(patternCount + 1);
  let stopTotal = 0;
  let timeTotal = 0;
  artifact.patterns.forEach((p, k) => {
    patternRoute[k] = p.routeId;
    patternTripCount[k] = p.trips.length;
    patternStopStart[k] = stopTotal;
    patternTimeStart[k] = timeTotal;
    stopTotal += p.stops.length;
    timeTotal += p.trips.length * p.stops.length * 2;
  });
  patternStopStart[patternCount] = stopTotal;
  patternTimeStart[patternCount] = timeTotal;
  const patternStops = new Int32Array(stopTotal);
  const stopTimes = new Int32Array(timeTotal);
  const memberships: [number, number, number][] = [];
  artifact.patterns.forEach((p, k) => {
    const s0 = patternStopStart[k] ?? 0;
    p.stops.forEach((id, i) => {
      const s = index(id);
      patternStops[s0 + i] = s;
      memberships.push([s, k, i]);
    });
    let t0 = patternTimeStart[k] ?? 0;
    for (const trip of p.trips) {
      if (trip.length !== p.stops.length * 2) {
        throw new Error(`pattern of route ${p.routeId}: a trip has ${trip.length} times for ${p.stops.length} stops`);
      }
      stopTimes.set(trip, t0);
      t0 += trip.length;
    }
  });
  const [stopPatternStart, stopPatternIds, stopPatternPos] = csr(stopCount, memberships, 2) as [
    Int32Array,
    Int32Array,
    Int32Array,
  ];
  const [transferStart, transferTo, transferWalk] = csr(
    stopCount,
    artifact.transfers.map(([from, to, walk]) => [index(from), index(to), walk] as [number, number, number]),
    2,
  ) as [Int32Array, Int32Array, Int32Array];

  return {
    feedVersionId: artifact.feedVersionId,
    date: artifact.date,
    stopCount,
    stopIds,
    stopIndex,
    stopLat,
    stopLon,
    patternCount,
    patternRoute,
    patternStopStart,
    patternStops,
    patternTripCount,
    patternTimeStart,
    stopTimes,
    stopPatternStart,
    stopPatternIds,
    stopPatternPos,
    transferStart,
    transferTo,
    transferWalk,
    grid: { cellDeg: GRID_DEG, buckets },
  };
}

/** Stop indexes whose bucket may hold stops within `radiusM` of a point (candidates only). */
export function candidateStops(timetable: Timetable, lat: number, lon: number, radiusM: number): number[] {
  const { cellDeg, buckets } = timetable.grid;
  const dLat = Math.ceil(radiusM / 111_000 / cellDeg);
  const dLon = Math.ceil(radiusM / (111_000 * Math.cos((lat * Math.PI) / 180)) / cellDeg);
  const row = Math.floor(lat / cellDeg);
  const col = Math.floor(lon / cellDeg);
  const found: number[] = [];
  for (let r = row - dLat; r <= row + dLat; r++) {
    for (let c = col - dLon; c <= col + dLon; c++) {
      const list = buckets.get(`${r}:${c}`);
      if (list !== undefined) {
        found.push(...list);
      }
    }
  }
  return found;
}
