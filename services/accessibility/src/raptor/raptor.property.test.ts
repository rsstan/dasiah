// RAPTOR on random networks against a slow, obviously correct search: round by round, try every
// trip, every boarding and every alighting position. No typed arrays, no marking, no binary search.
import { haversineM, walkSeconds } from '@heatmap/common';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { raptor, UNREACHED } from './raptor.ts';
import { buildTimetable, type TimetableArtifact } from './timetable.ts';

const ORIGIN = { lat: 52, lon: 21 };
const DEPARTURE = 28_800;

interface Network {
  artifact: TimetableArtifact;
  maxRounds: number;
  horizonS: number;
}

/** Trips of one pattern: each runs at or after the previous one at every stop. */
const tripsArb = (stops: number) =>
  fc
    .array(
      fc.record({
        gap: fc.integer({ min: 0, max: 900 }),
        legs: fc.array(fc.record({ ride: fc.integer({ min: 0, max: 600 }), dwell: fc.integer({ min: 0, max: 60 }) }), {
          minLength: stops,
          maxLength: stops,
        }),
      }),
      { minLength: 1, maxLength: 5 },
    )
    .map((trips) => {
      const result: number[][] = [];
      let start = DEPARTURE - 600;
      for (const { gap, legs } of trips) {
        start += gap;
        const before = result.at(-1);
        let clock = start;
        result.push(
          legs.flatMap(({ ride, dwell }, i) => {
            const arrival = Math.max(clock + (i === 0 ? 0 : ride), before?.[i * 2] ?? -Infinity);
            const departure = Math.max(arrival + dwell, before?.[i * 2 + 1] ?? -Infinity);
            clock = departure;
            return [arrival, departure];
          }),
        );
      }
      return result;
    });

const networkArb: fc.Arbitrary<Network> = fc.integer({ min: 2, max: 8 }).chain((n) => {
  const stopId = fc.integer({ min: 0, max: n - 1 });
  const patternArb = fc
    .array(stopId, { minLength: 2, maxLength: 6 })
    .chain((stops) => tripsArb(stops.length).map((trips) => ({ routeId: 1, stops: stops.map((s) => s * 10), trips })));
  return fc.record({
    artifact: fc.record({
      version: fc.constant(1 as const),
      feedVersionId: fc.constant(1),
      date: fc.constant('2026-11-24'),
      stops: fc
        .array(fc.record({ dLat: fc.integer({ min: 0, max: 30 }), dLon: fc.integer({ min: 0, max: 30 }) }), {
          minLength: n,
          maxLength: n,
        })
        .map((list) => list.map((s, i) => ({ id: i * 10, lat: 52 + s.dLat / 1_000, lon: 21 + s.dLon / 1_000 }))),
      transfers: fc
        .uniqueArray(fc.tuple(stopId, stopId, fc.integer({ min: 0, max: 300 })), {
          selector: ([a, b]) => `${a}:${b}`,
          maxLength: 8,
        })
        .map((list) =>
          list.filter(([a, b]) => a !== b).map(([a, b, w]) => [a * 10, b * 10, w] as [number, number, number]),
        ),
      patterns: fc.array(patternArb, { minLength: 1, maxLength: 5 }),
    }),
    maxRounds: fc.integer({ min: 1, max: 5 }),
    horizonS: fc.constantFrom(600, 1_800, 7_200),
  });
});

function oracle({ artifact, maxRounds, horizonS }: Network): number[] {
  const limit = DEPARTURE + horizonS;
  const at = (id: number) => artifact.stops.findIndex((s) => s.id === id);
  let best = artifact.stops.map((s) => {
    const meters = haversineM(ORIGIN, s);
    const t = DEPARTURE + walkSeconds(meters);
    return meters <= 1_000 && t <= limit ? t : UNREACHED;
  });
  for (let round = 1; round <= maxRounds; round++) {
    const ridden = [...best];
    for (const { stops, trips } of artifact.patterns) {
      for (const trip of trips) {
        for (let i = 0; i < stops.length; i++) {
          if ((best[at(stops[i] ?? -1)] ?? UNREACHED) > (trip[i * 2 + 1] ?? 0)) {
            continue; // cannot be at this stop when the trip leaves
          }
          for (let j = i + 1; j < stops.length; j++) {
            const s = at(stops[j] ?? -1);
            const arrival = trip[j * 2] ?? UNREACHED;
            if (arrival <= limit) {
              ridden[s] = Math.min(ridden[s] ?? UNREACHED, arrival);
            }
          }
        }
      }
    }
    // One footpath, only from stops that riding improved in this round.
    const walked = [...ridden];
    for (const [from, to, walkS] of artifact.transfers) {
      const t = (ridden[at(from)] ?? UNREACHED) + walkS;
      if ((ridden[at(from)] ?? UNREACHED) < (best[at(from)] ?? UNREACHED) && t <= limit) {
        walked[at(to)] = Math.min(walked[at(to)] ?? UNREACHED, t);
      }
    }
    best = walked;
  }
  return best;
}

describe('RAPTOR (properties)', () => {
  it('finds the earliest arrival at every stop of any network', () => {
    fc.assert(
      fc.property(networkArb, (network) => {
        const { arrival } = raptor(buildTimetable(network.artifact), ORIGIN, DEPARTURE, network);
        expect([...arrival]).toEqual(oracle(network));
      }),
      { numRuns: 2_000 },
    );
  });

  it('walks one footpath after a trip, not two (found by the property above)', () => {
    const stop = (id: number, lon: number) => ({ id, lat: 52, lon });
    const artifact: TimetableArtifact = {
      version: 1,
      feedVersionId: 1,
      date: '2026-11-24',
      stops: [stop(0, 21), stop(1, 21.1), stop(2, 21.2), stop(3, 21.3)],
      transfers: [
        [1, 2, 10],
        [2, 3, 10],
      ],
      // The trip reaches stop 2 late; walking there from stop 1 is faster, but ends at stop 2.
      patterns: [{ routeId: 1, stops: [0, 1, 2], trips: [[0, 60, 120, 120, 600, 600].map((t) => DEPARTURE + t)] }],
    };
    const { arrival } = raptor(buildTimetable(artifact), ORIGIN, DEPARTURE);
    expect([...arrival].map((t) => t - DEPARTURE)).toEqual([0, 120, 130, 610]);
  });

  it('includes arrivals exactly at the horizon and trips leaving exactly on arrival', () => {
    const line = (stops: number[], times: number[]) => ({
      routeId: 1,
      stops,
      trips: [times.map((t) => DEPARTURE + t)],
    });
    const artifact: TimetableArtifact = {
      version: 1,
      feedVersionId: 1,
      date: '2026-11-24',
      stops: [0, 1, 2, 3].map((id) => ({ id, lat: 52, lon: 21 + id / 10 })),
      transfers: [[2, 3, 100]],
      patterns: [line([0, 1], [0, 0, 300, 300]), line([1, 2], [0, 300, 500, 500])],
    };
    const at = (horizonS: number) =>
      [...raptor(buildTimetable(artifact), ORIGIN, DEPARTURE, { horizonS }).arrival].map((t) =>
        t === UNREACHED ? null : t - DEPARTURE,
      );
    expect(at(600)).toEqual([0, 300, 500, 600]);
    expect(at(599)).toEqual([0, 300, 500, null]);
    expect(at(500)).toEqual([0, 300, 500, null]);
    expect(at(499)).toEqual([0, 300, null, null]);
    expect(at(0)).toEqual([0, null, null, null]);
  });

  it('without footpaths, another line never makes an arrival later', () => {
    fc.assert(
      fc.property(networkArb, ({ artifact, ...options }) => {
        const bare = { ...artifact, transfers: [] };
        const full = raptor(buildTimetable(bare), ORIGIN, DEPARTURE, options).arrival;
        const fewer = { ...bare, patterns: bare.patterns.slice(1) };
        const less = raptor(buildTimetable(fewer), ORIGIN, DEPARTURE, options).arrival;
        full.forEach((t, s) => expect(t).toBeLessThanOrEqual(less[s] ?? UNREACHED));
      }),
      { numRuns: 500 },
    );
  });

  it('stays between departure and horizon, and needs no more rounds than allowed', () => {
    fc.assert(
      fc.property(networkArb, (network) => {
        const r = raptor(buildTimetable(network.artifact), ORIGIN, DEPARTURE, network);
        expect(r.rounds).toBeLessThanOrEqual(network.maxRounds);
        for (const t of r.arrival) {
          expect(t === UNREACHED || (t >= DEPARTURE && t <= DEPARTURE + network.horizonS)).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });
});
