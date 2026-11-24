import { UnprocessableError } from '@heatmap/common';
import { cellToLatLng, getResolution, latLngToCell } from 'h3-js';
import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../timetables/store.ts';
import { defaultDate, departures, localDate, normalise } from './request.ts';

const ORIGIN = { lat: 52.23, lon: 21.01 };
const CELL = latLngToCell(ORIGIN.lat, ORIGIN.lon, 9);

/** A snapshot whose grid is the one cell around ORIGIN. */
function snapshot(validFrom = '2026-11-01', validTo = '2027-03-31', cityCode = 'waw'): Snapshot {
  return {
    cityCode,
    feedVersionId: 1,
    validFrom,
    validTo,
    cells: {
      resolution: 9,
      count: 1,
      h3: [CELL],
      lat: Float64Array.of(ORIGIN.lat),
      lon: Float64Array.of(ORIGIN.lon),
      accessStart: Int32Array.of(0, 0),
      accessStop: new Int32Array(),
      accessWalk: new Int32Array(),
    },
    cellIndex: new Map([[CELL, 0]]),
    loadedAt: new Date(0),
  };
}

const problemOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(UnprocessableError);
    return (error as UnprocessableError).type;
  }
  throw new Error('expected an error');
};

describe('local date of a city', () => {
  it('changes at local midnight, in winter and in summer time', () => {
    expect(localDate('waw', new Date('2026-12-01T22:59:59Z'))).toBe('2026-12-01'); // 23:59 CET
    expect(localDate('waw', new Date('2026-12-01T23:00:00Z'))).toBe('2026-12-02');
    expect(localDate('vno', new Date('2026-12-01T22:00:00Z'))).toBe('2026-12-02'); // EET
    expect(localDate('waw', new Date('2026-07-01T22:00:00Z'))).toBe('2026-07-02'); // CEST
  });

  it('falls back to UTC for a city without a known zone', () => {
    expect(localDate('xxx', new Date('2026-12-01T23:30:00Z'))).toBe('2026-12-01');
  });
});

describe('default date: the next working day', () => {
  it.each([
    ['Monday', '2026-11-23', '2026-11-24'],
    ['Friday', '2026-11-27', '2026-11-30'],
    ['Saturday', '2026-11-28', '2026-11-30'],
    ['Sunday', '2026-11-29', '2026-11-30'],
    ['the last day of a month', '2026-12-31', '2027-01-01'],
  ])('from %s', (_, today, expected) => {
    expect(defaultDate(snapshot(), today)).toBe(expected);
  });

  it('is the first working day of a timetable that has not started', () => {
    // 2026-11-01 is a Sunday.
    expect(defaultDate(snapshot(), '2026-10-10')).toBe('2026-11-02');
    expect(defaultDate(snapshot('2026-11-03'), '2026-10-10')).toBe('2026-11-03');
  });

  it('may be the last day of the validity, but not later', () => {
    expect(defaultDate(snapshot('2026-11-01', '2026-11-24'), '2026-11-23')).toBe('2026-11-24');
    expect(problemOf(() => defaultDate(snapshot('2026-11-01', '2026-11-24'), '2026-11-24'))).toBe(
      '/problems/date-outside-feed',
    );
    // Only a weekend is left.
    expect(problemOf(() => defaultDate(snapshot('2026-11-01', '2026-11-29'), '2026-11-27'))).toBe(
      '/problems/date-outside-feed',
    );
  });
});

describe('normalise', () => {
  const now = new Date('2026-11-23T10:00:00Z');

  it('fills in date and time and snaps the origin to its resolution-10 cell', () => {
    const r = normalise({ cityCode: 'waw', origin: ORIGIN }, snapshot(), now);
    expect(r).toMatchObject({ date: '2026-11-24', time: '08:00', departureS: 28_800, windowS: 0 });
    expect(getResolution(r.originH3)).toBe(10);
    expect([r.origin.lat, r.origin.lon]).toEqual(cellToLatLng(r.originH3));
  });

  it('keeps what the caller gave', () => {
    const r = normalise(
      { cityCode: 'waw', origin: ORIGIN, date: '2026-12-05', time: '23:55', windowMinutes: 30 },
      snapshot(),
      now,
    );
    expect(r).toMatchObject({ date: '2026-12-05', departureS: 86_100, windowS: 1_800 });
    expect(normalise({ cityCode: 'waw', origin: ORIGIN, time: '00:00' }, snapshot(), now).departureS).toBe(0);
  });

  it('gives the same key to two points of one cell', () => {
    const near = { lat: ORIGIN.lat + 0.000001, lon: ORIGIN.lon };
    const key = (origin: typeof ORIGIN) => normalise({ cityCode: 'waw', origin }, snapshot(), now).originH3;
    expect(key(near)).toBe(key(ORIGIN));
  });

  it('refuses an origin outside the grid and a date outside the validity, accepts its ends', () => {
    expect(problemOf(() => normalise({ cityCode: 'waw', origin: { lat: 54.6, lon: 25.2 } }, snapshot(), now))).toBe(
      '/problems/origin-outside-city',
    );
    const on = (date: string) => () => normalise({ cityCode: 'waw', origin: ORIGIN, date }, snapshot(), now);
    expect(problemOf(on('2026-10-31'))).toBe('/problems/date-outside-feed');
    expect(problemOf(on('2027-04-01'))).toBe('/problems/date-outside-feed');
    expect(on('2026-11-01')().date).toBe('2026-11-01');
    expect(on('2027-03-31')().date).toBe('2027-03-31');
  });
});

describe('departures', () => {
  it('is one departure without a window, else every five minutes including both ends', () => {
    expect(departures({ ...base(), windowS: 0 })).toEqual([28_800]);
    expect(departures({ ...base(), windowS: 600 })).toEqual([28_800, 29_100, 29_400]);
    expect(departures({ ...base(), windowS: 420 })).toEqual([28_800, 29_100]); // not past the end
  });

  function base() {
    return { ...normalise({ cityCode: 'waw', origin: ORIGIN, date: '2026-11-24' }, snapshot(), new Date()) };
  }
});
