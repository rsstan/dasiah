// Distances and the walking model. The walking model must match transit.walk_seconds() in the
// database (docs/05-algorithms.md#3): straight-line distance x 1.3 at 5 km/h (1.389 m/s).
// The database measures on the spheroid, this module on a sphere: results may differ by a
// second for the same pair of points.

export const EARTH_RADIUS_M = 6_371_008.8;
export const DETOUR_FACTOR = 1.3;
export const WALK_SPEED_M_S = 1.389;

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Walking time in seconds for a straight-line distance in metres. */
export function walkSeconds(meters: number): number {
  return Math.ceil((meters * DETOUR_FACTOR) / WALK_SPEED_M_S);
}
