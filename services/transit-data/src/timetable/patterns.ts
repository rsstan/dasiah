// Route patterns for RAPTOR: trips of one route with exactly the same stop sequence, sorted by
// the departure at the first stop, split so that no trip overtakes another inside a pattern
// (RAPTOR picks "the earliest trip that can be caught" by binary search, which is only correct
// when trips never pass each other).

export interface TripTimes {
  readonly routeId: number;
  readonly stops: readonly number[];
  /** Flat [arr0, dep0, arr1, dep1, ...] in seconds of the service day. */
  readonly times: readonly number[];
}

export interface Pattern {
  readonly routeId: number;
  readonly stops: readonly number[];
  readonly trips: readonly (readonly number[])[];
}

/** true when `later` is at or after `earlier` at every stop (arrival and departure). */
function neverEarlier(earlier: readonly number[], later: readonly number[]): boolean {
  for (let i = 0; i < earlier.length; i++) {
    if ((later[i] ?? 0) < (earlier[i] ?? 0)) {
      return false;
    }
  }
  return true;
}

export function buildPatterns(trips: readonly TripTimes[]): Pattern[] {
  const groups = new Map<string, TripTimes[]>();
  for (const trip of trips) {
    if (trip.stops.length < 2 || trip.times.length !== trip.stops.length * 2) {
      continue; // a trip that serves fewer than two stops cannot carry anyone
    }
    const key = `${trip.routeId}|${trip.stops.join(',')}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [trip]);
    } else {
      group.push(trip);
    }
  }

  const patterns: Pattern[] = [];
  const keys = [...groups.keys()].sort((a, b) => {
    const [ra, sa] = a.split('|');
    const [rb, sb] = b.split('|');
    return Number(ra) - Number(rb) || (sa ?? '').localeCompare(sb ?? '');
  });
  for (const key of keys) {
    const group = groups.get(key) ?? [];
    const sorted = [...group].sort(
      (a, b) => (a.times[1] ?? 0) - (b.times[1] ?? 0) || (a.times.at(-1) ?? 0) - (b.times.at(-1) ?? 0),
    );
    const lanes: (readonly number[])[][] = [];
    for (const trip of sorted) {
      const lane = lanes.find((l) => neverEarlier(l[l.length - 1] ?? [], trip.times));
      if (lane === undefined) {
        lanes.push([trip.times]);
      } else {
        lane.push(trip.times);
      }
    }
    const first = group[0];
    if (first !== undefined) {
      for (const lane of lanes) {
        patterns.push({ routeId: first.routeId, stops: first.stops, trips: lane });
      }
    }
  }
  return patterns;
}
