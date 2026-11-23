// City, start point and departure in the query string (?city=vno&lat=..&lon=..&date=..&time=..).
// Only coordinates rounded to ~10 m are written; the address text is not put in the URL.
export interface Origin {
  lat: number;
  lon: number;
  /** Shown in the address box. */
  label: string;
  /** Geocoded address, when the point came from search or a saved place. */
  address?: string | undefined;
}

export interface UrlState {
  city?: string | undefined;
  origin?: Origin | undefined;
  date?: string | undefined;
  time?: string | undefined;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function readUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  const valid = params.has('lat') && params.has('lon') && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const date = params.get('date') ?? '';
  const time = params.get('time') ?? '';
  return {
    city: params.get('city') ?? undefined,
    origin:
      valid && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, label: 'Shared start point' } : undefined,
    date: DATE.test(date) ? date : undefined,
    time: TIME.test(time) ? time : undefined,
  };
}

export function toSearch(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.city !== undefined) {
    params.set('city', state.city);
  }
  if (state.origin !== undefined) {
    params.set('lat', state.origin.lat.toFixed(4));
    params.set('lon', state.origin.lon.toFixed(4));
  }
  if (state.date !== undefined && state.date !== '') {
    params.set('date', state.date);
  }
  if (state.time !== undefined && state.time !== '') {
    params.set('time', state.time);
  }
  const s = params.toString();
  return s === '' ? '' : `?${s}`;
}
