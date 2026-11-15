// GET /geocode: answer from places.geocode_cache when fresh; otherwise ask the geocoder and keep
// its best answer; if the geocoder is unavailable, fall back to the cache even when expired
// (fallback pattern), and only then answer 503. The query text is never logged (it may be an
// address).
import { NotFoundError, ServiceUnavailableError } from '@heatmap/common';
import type { AppContext } from '../context.ts';
import type { Candidate } from '../geocoding/geocoder.ts';

export const MAX_CANDIDATES = 5;

/** Cache key: lower case, trimmed, inner whitespace collapsed (matches geocode_cache_norm). */
export function normaliseQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface CachedRow {
  display_name: string;
  lat: number;
  lon: number;
  fresh: boolean;
}

export async function geocode(ctx: AppContext, cityCode: string, q: string): Promise<{ items: Candidate[] }> {
  const bounds = await ctx.cities.bounds(cityCode).catch((error: unknown) => {
    throw new ServiceUnavailableError('The list of cities is not available right now.', 10, {}, { cause: error });
  });
  if (bounds === undefined) {
    throw new NotFoundError(`Unknown city ${cityCode}.`, { type: '/problems/unknown-city' });
  }
  const norm = normaliseQuery(q);
  const { rows } = await ctx.pool.query<CachedRow>(
    `SELECT display_name, ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lon, expires_at > now() AS fresh
       FROM places.geocode_cache WHERE city_code = $1 AND query_norm = $2`,
    [cityCode, norm],
  );
  const cached = rows[0];
  const fromCache = (row: CachedRow) => ({ items: [{ displayName: row.display_name, lat: row.lat, lon: row.lon }] });
  if (cached?.fresh === true) {
    return fromCache(cached);
  }

  let candidates: Candidate[];
  try {
    candidates = await ctx.geocoder.search(q.trim(), bounds, MAX_CANDIDATES);
  } catch (error) {
    if (cached !== undefined) {
      ctx.logger.warn({ city: cityCode, err: error }, 'geocoder unavailable, answered from an expired cache entry');
      return fromCache(cached);
    }
    throw new ServiceUnavailableError(
      'Address search is unavailable right now.',
      30,
      { type: '/problems/geocoder-unavailable' },
      {
        cause: error,
      },
    );
  }

  const best = candidates[0];
  if (best !== undefined) {
    await ctx.pool.query(
      `INSERT INTO places.geocode_cache (city_code, query_norm, display_name, geom, provider, expires_at)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6, now() + make_interval(secs => $7))
       ON CONFLICT (city_code, query_norm) DO UPDATE
         SET display_name = EXCLUDED.display_name, geom = EXCLUDED.geom, provider = EXCLUDED.provider,
             fetched_at = now(), expires_at = EXCLUDED.expires_at`,
      [cityCode, norm, best.displayName, best.lat, best.lon, ctx.geocoder.provider, ctx.config.GEOCODE_CACHE_TTL_S],
    );
  }
  ctx.logger.info({ city: cityCode, candidates: candidates.length }, 'geocoded');
  return { items: candidates };
}
