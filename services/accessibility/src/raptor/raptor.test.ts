// RAPTOR against the hand-computed answers of fixtures/gtfs/testville/README.md, using the
// timetable artifacts that transit-data builds (fixtures/gtfs/testville/artifacts, kept in sync
// by transit-data.itest.ts).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { raptor, stopsNear, UNREACHED } from './raptor.ts';
import { buildTimetable, type Timetable, type TimetableArtifact } from './timetable.ts';

const FIXTURE = resolve(import.meta.dirname, '../../../../fixtures/gtfs/testville');

const stopsTxt = readFileSync(resolve(FIXTURE, 'stops.txt'), 'utf8').trim().split('\n').slice(1);
/** Letter -> position, from stops.txt (boarding stops only). */
const POSITIONS = new Map(
  stopsTxt
    .map((line) => line.split(','))
    .filter((f) => f[5] !== '1')
    .map((f) => [f[0] ?? '', { lat: Number(f[3]), lon: Number(f[4]) }] as const),
);

function load(date: string): Timetable {
  return buildTimetable(
    JSON.parse(readFileSync(resolve(FIXTURE, `artifacts/timetable-${date}.json`), 'utf8')) as TimetableArtifact,
  );
}

const t = (h: number, m: number, s = 0): number => h * 3600 + m * 60 + s;

/** Arrival per stop letter for a query from stop `from` at `departure` (unreached stops omitted). */
function query(tt: Timetable, from: string, departure: number): Map<string, number> {
  const origin = POSITIONS.get(from);
  if (origin === undefined) {
    throw new Error(`unknown stop ${from}`);
  }
  const { arrival } = raptor(tt, origin, departure);
  const result = new Map<string, number>();
  for (const [letter, pos] of POSITIONS) {
    const index = [...tt.stopIds.keys()].find(
      (i) => Math.abs((tt.stopLat[i] ?? 0) - pos.lat) < 1e-6 && Math.abs((tt.stopLon[i] ?? 0) - pos.lon) < 1e-6,
    );
    const value = index === undefined ? UNREACHED : (arrival[index] ?? UNREACHED);
    if (value !== UNREACHED) {
      result.set(letter, value);
    }
  }
  return result;
}

const wednesday = load('2026-12-02');
const saturday = load('2026-12-05');
const christmasEve = load('2026-12-24');

describe('RAPTOR on testville (README "Expected earliest arrivals")', () => {
  it('builds the in-memory timetable from the artifact', () => {
    expect(wednesday.stopCount).toBe(12);
    expect(wednesday.patternCount).toBe(8);
    expect(wednesday.transferTo).toHaveLength(2);
  });

  it('1. direct trip', () => {
    const r = query(wednesday, 'A', t(8, 0));
    expect(r.get('B')).toBe(t(8, 4));
    expect(r.get('C')).toBe(t(8, 8));
    expect(r.get('D')).toBe(t(8, 13));
  });

  it('2. a faster trip that requires waiting', () => {
    expect(query(wednesday, 'A', t(8, 0)).get('E')).toBe(t(8, 15));
  });

  it('3. one transfer at the same stop', () => {
    const r = query(wednesday, 'A', t(8, 0));
    expect(r.get('G')).toBe(t(8, 15));
    expect(r.get('F')).toBe(t(8, 18));
    expect(r.get('K')).toBe(t(8, 14));
  });

  it('4. transfer on foot', () => {
    const r = query(wednesday, 'A', t(8, 0));
    expect(r.get('H')).toBe(t(8, 15, 37));
    expect(r.get('I')).toBe(t(8, 26));
    expect(r.get('J')).toBe(t(8, 32));
  });

  it('5. overtaking trips', () => {
    const r = query(wednesday, 'A', t(8, 14));
    expect(Object.fromEntries([...r].filter(([k]) => 'BCDEGFJ'.includes(k)))).toEqual({
      B: t(8, 21),
      C: t(8, 27),
      D: t(8, 33),
      E: t(8, 37),
      G: t(8, 35),
      F: t(8, 48),
      J: t(9, 2),
    });
  });

  it('6. trip past midnight, same day', () => {
    const r = query(wednesday, 'D', t(23, 59));
    expect(r.get('E')).toBe(86_820);
    // Origin walk D -> H: 157 s in PostGIS, the haversine model may give one second less.
    expect(Math.abs((r.get('H') ?? 0) - t(24, 1, 37))).toBeLessThanOrEqual(1);
  });

  it('7. trip past midnight, from the previous day', () => {
    expect(query(saturday, 'D', t(0, 0)).get('E')).toBe(t(0, 7));
  });

  it('8. calendar exception: the weekend timetable on 2026-12-24', () => {
    const r = query(christmasEve, 'A', t(8, 0));
    expect(r.get('B')).toBe(t(9, 4));
    expect(r.get('C')).toBe(t(9, 8));
    expect(r.get('D')).toBe(t(9, 13));
    expect(r.get('E')).toBe(t(9, 17));
    for (const unreachable of ['F', 'G', 'I', 'J', 'K']) {
      expect(r.has(unreachable), unreachable).toBe(false);
    }
  });

  it('9. weekend: same as case 8', () => {
    expect(query(saturday, 'A', t(8, 0))).toEqual(query(christmasEve, 'A', t(8, 0)));
  });

  it('10. a stop without trips is never reached', () => {
    for (const [from, departure] of [
      ['A', t(8, 0)],
      ['A', t(8, 14)],
      ['D', t(23, 59)],
    ] as const) {
      expect(query(wednesday, from, departure).has('M')).toBe(false);
    }
  });

  it('respects the horizon and the number of rounds', () => {
    // 15-minute horizon from A at 08:00: E (08:15) still reached, J (08:32) not.
    const tt = wednesday;
    const origin = POSITIONS.get('A') ?? { lat: 0, lon: 0 };
    const short = raptor(tt, origin, t(8, 0), { horizonS: 900 });
    const reachedShort = [...short.arrival].filter((v) => v !== UNREACHED).length;
    const full = raptor(tt, origin, t(8, 0));
    expect(reachedShort).toBeLessThan([...full.arrival].filter((v) => v !== UNREACHED).length);
    // One round = no transfer: G needs a change at C.
    const direct = raptor(tt, origin, t(8, 0), { maxRounds: 1 });
    const g = POSITIONS.get('G');
    const gIndex = [...tt.stopIds.keys()].find((i) => tt.stopLat[i] === g?.lat && tt.stopLon[i] === g?.lon) ?? -1;
    expect(direct.arrival[gIndex]).toBe(UNREACHED);
  });

  it('agrees with an independent connection scan on every stop and departure time', () => {
    for (const tt of [wednesday, saturday, christmasEve]) {
      const departures = [
        ...Array.from({ length: 20 }, (_, i) => t(7, 30) + i * 7 * 60),
        t(23, 30),
        t(23, 55),
        t(0, 0),
      ];
      for (const [, origin] of POSITIONS) {
        for (const departure of departures) {
          expect([...raptor(tt, origin, departure).arrival]).toEqual(connectionScan(tt, origin, departure));
        }
      }
    }
  });
});

/**
 * Reference: connection scan (Dibbelt et al.) over the same timetable, unlimited transfers,
 * footpaths applied after every improvement (one hop, as in RAPTOR), same access walk and horizon.
 */
function connectionScan(tt: Timetable, origin: { lat: number; lon: number }, departure: number): number[] {
  const limit = departure + 7_200;
  const best = new Array<number>(tt.stopCount).fill(UNREACHED);
  for (const { stop, walkS } of stopsNear(tt, origin, 1_000)) {
    best[stop] = Math.min(best[stop] ?? UNREACHED, departure + walkS);
  }
  const connections: { dep: number; arr: number; from: number; to: number; trip: string }[] = [];
  for (let p = 0; p < tt.patternCount; p++) {
    const s0 = tt.patternStopStart[p] ?? 0;
    const n = (tt.patternStopStart[p + 1] ?? 0) - s0;
    const t0 = tt.patternTimeStart[p] ?? 0;
    for (let trip = 0; trip < (tt.patternTripCount[p] ?? 0); trip++) {
      for (let i = 0; i + 1 < n; i++) {
        connections.push({
          dep: tt.stopTimes[t0 + (trip * n + i) * 2 + 1] ?? 0,
          arr: tt.stopTimes[t0 + (trip * n + i + 1) * 2] ?? 0,
          from: tt.patternStops[s0 + i] ?? 0,
          to: tt.patternStops[s0 + i + 1] ?? 0,
          trip: `${p}:${trip}`,
        });
      }
    }
  }
  connections.sort((a, b) => a.dep - b.dep);
  const boarded = new Set<string>();
  for (const c of connections) {
    if (c.dep < departure) {
      continue;
    }
    if (boarded.has(c.trip) || (best[c.from] ?? UNREACHED) <= c.dep) {
      boarded.add(c.trip);
      if (c.arr < (best[c.to] ?? UNREACHED) && c.arr <= limit) {
        best[c.to] = c.arr;
        for (let j = tt.transferStart[c.to] ?? 0; j < (tt.transferStart[c.to + 1] ?? 0); j++) {
          const to = tt.transferTo[j] ?? 0;
          const walked = c.arr + (tt.transferWalk[j] ?? 0);
          if (walked < (best[to] ?? UNREACHED) && walked <= limit) {
            best[to] = walked;
          }
        }
      }
    }
  }
  return best;
}
