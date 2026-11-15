// Normalising a calculation request: origin snapped to its H3 resolution-10 cell (cache key and
// data minimisation), default date and time, checks against the city grid and feed validity.
import { UnprocessableError } from '@heatmap/common';
import { cellToLatLng, latLngToCell } from 'h3-js';
import type { Snapshot } from '../timetables/store.ts';

export const ORIGIN_RESOLUTION = 10;
export const DEFAULT_TIME = '08:00';
export const WINDOW_STEP_S = 300;

const TIMEZONES: Record<string, string> = { waw: 'Europe/Warsaw', vno: 'Europe/Vilnius' };

export interface CalculationInput {
  readonly cityCode: string;
  readonly origin: { readonly lat: number; readonly lon: number };
  readonly date?: string;
  readonly time?: string;
  readonly windowMinutes?: number;
}

export interface NormalisedRequest {
  readonly cityCode: string;
  readonly originH3: string;
  /** Centre of the origin cell: the point the calculation starts from. */
  readonly origin: { readonly lat: number; readonly lon: number };
  readonly date: string;
  readonly time: string;
  readonly departureS: number;
  readonly windowS: number;
}

/** Local date in the city's time zone, YYYY-MM-DD. */
export function localDate(cityCode: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONES[cityCode] ?? 'UTC' }).format(now);
}

const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The next working day (Monday to Friday) from tomorrow on, inside the validity of the snapshot. */
export function defaultDate(snapshot: Snapshot, today: string): string {
  let date = addDays(today < snapshot.validFrom ? addDays(snapshot.validFrom, -1) : today, 1);
  for (let i = 0; i < 7 && date <= snapshot.validTo; i++) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday >= 1 && weekday <= 5) {
      return date;
    }
    date = addDays(date, 1);
  }
  throw new UnprocessableError('The timetable has no working day left in its validity.', {
    type: '/problems/date-outside-feed',
  });
}

export function normalise(input: CalculationInput, snapshot: Snapshot, now: Date): NormalisedRequest {
  const cityCell = latLngToCell(input.origin.lat, input.origin.lon, snapshot.cells.resolution);
  if (!snapshot.cellIndex.has(cityCell)) {
    throw new UnprocessableError(`The origin is outside ${snapshot.cityCode}.`, {
      type: '/problems/origin-outside-city',
    });
  }
  const date = input.date ?? defaultDate(snapshot, localDate(snapshot.cityCode, now));
  if (date < snapshot.validFrom || date > snapshot.validTo) {
    throw new UnprocessableError(
      `${date} is outside the timetable validity (${snapshot.validFrom} to ${snapshot.validTo}).`,
      {
        type: '/problems/date-outside-feed',
      },
    );
  }
  const time = input.time ?? DEFAULT_TIME;
  const [hh, mm] = time.split(':').map(Number);
  const originH3 = latLngToCell(input.origin.lat, input.origin.lon, ORIGIN_RESOLUTION);
  const [lat, lon] = cellToLatLng(originH3);
  return {
    cityCode: snapshot.cityCode,
    originH3,
    origin: { lat, lon },
    date,
    time,
    departureS: (hh ?? 0) * 3600 + (mm ?? 0) * 60,
    windowS: (input.windowMinutes ?? 0) * 60,
  };
}

/** Departures of a request: one, or every 5 minutes across the window. */
export function departures(request: NormalisedRequest): number[] {
  if (request.windowS === 0) {
    return [request.departureS];
  }
  const list: number[] = [];
  for (let t = request.departureS; t <= request.departureS + request.windowS; t += WINDOW_STEP_S) {
    list.push(t);
  }
  return list;
}
