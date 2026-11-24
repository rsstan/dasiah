import { describe, expect, it } from 'vitest';
import { buildTimetable, candidateStops, type TimetableArtifact } from './timetable.ts';

const artifact = (change: Partial<TimetableArtifact> = {}): TimetableArtifact => ({
  version: 1,
  feedVersionId: 1,
  date: '2026-11-24',
  stops: [
    { id: 7, lat: 52, lon: 21 },
    { id: 3, lat: 52.001, lon: 21.001 },
    { id: 9, lat: 52.5, lon: 21.5 },
  ],
  transfers: [[7, 3, 120]],
  patterns: [{ routeId: 1, stops: [7, 3, 7], trips: [[0, 0, 60, 70, 120, 120]] }],
  ...change,
});

describe('in-memory timetable', () => {
  it('lists a stop served twice by one pattern with both positions', () => {
    const tt = buildTimetable(artifact());
    const s = tt.stopIndex.get(7) ?? -1;
    const range = [tt.stopPatternStart[s], tt.stopPatternStart[s + 1]];
    expect([...tt.stopPatternPos.slice(...range)]).toEqual([0, 2]);
    expect([...tt.transferTo]).toEqual([tt.stopIndex.get(3)]);
  });

  it('can be empty', () => {
    const tt = buildTimetable(artifact({ stops: [], transfers: [], patterns: [] }));
    expect([tt.stopCount, tt.patternCount, tt.stopTimes.length]).toEqual([0, 0, 0]);
  });

  it('refuses unknown stops and trips of the wrong length', () => {
    expect(() => buildTimetable(artifact({ transfers: [[7, 99, 1]] }))).toThrow(/unknown stop 99/);
    expect(() => buildTimetable(artifact({ patterns: [{ routeId: 1, stops: [7, 99], trips: [] }] }))).toThrow(
      /unknown stop 99/,
    );
    expect(() => buildTimetable(artifact({ patterns: [{ routeId: 5, stops: [7, 3], trips: [[0, 0]] }] }))).toThrow(
      /route 5: a trip has 2 times for 2 stops/,
    );
  });

  it('offers every stop within the radius as a candidate, also across bucket borders', () => {
    const tt = buildTimetable(artifact());
    const near = candidateStops(tt, 51.9999, 20.9999, 500).map((s) => tt.stopIds[s]);
    expect(near.sort()).toEqual([3, 7]);
    expect(candidateStops(tt, 10, 10, 500)).toEqual([]);
  });
});
