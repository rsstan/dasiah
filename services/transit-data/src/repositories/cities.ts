// Cities, their grid and coverage (schema transit only).
import { sql, type Kysely } from 'kysely';
import type { GridCell } from '../domain/grid.ts';
import type { TransitDb } from './schema.ts';

type Db = Kysely<TransitDb>;

export interface CityRow {
  readonly cityId: number;
  readonly code: string;
  readonly name: string;
  readonly countryCode: string;
  readonly timezone: string;
  readonly h3Resolution: number;
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
  readonly feedVersionId: number | null;
  readonly validFrom: string | null;
  readonly validTo: string | null;
}

function selectCities(db: Db) {
  return db
    .selectFrom('transit.cities as c')
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('transit.v_active_feeds as af')
          .select(['af.feed_version_id', 'af.valid_from', 'af.valid_to'])
          .whereRef('af.city_code', '=', 'c.code')
          .orderBy('af.activated_at', 'desc')
          .limit(1)
          .as('af'),
      (join) => join.onTrue(),
    )
    .select([
      'c.city_id as cityId',
      'c.code',
      'c.name',
      sql<string>`c.country_code::text`.as('countryCode'),
      'c.timezone',
      'c.h3_resolution as h3Resolution',
      sql<number>`ST_XMin(c.bounds)`.as('west'),
      sql<number>`ST_YMin(c.bounds)`.as('south'),
      sql<number>`ST_XMax(c.bounds)`.as('east'),
      sql<number>`ST_YMax(c.bounds)`.as('north'),
      'af.feed_version_id as feedVersionId',
      'af.valid_from as validFrom',
      'af.valid_to as validTo',
    ]);
}

export async function listEnabledCities(db: Db): Promise<CityRow[]> {
  return selectCities(db).where('c.is_enabled', '=', true).orderBy('c.name').execute();
}

export async function findCity(db: Db, code: string): Promise<CityRow | undefined> {
  return selectCities(db).where('c.code', '=', code).executeTakeFirst();
}

/** undefined while no feed has been activated (the view is created WITH NO DATA). */
export async function findCoverage(db: Db, code: string) {
  return selectCoverage(db, code).catch((error: unknown) => {
    if ((error as { code?: string }).code === '55000') {
      return undefined; // materialized view has not been populated yet
    }
    throw error;
  });
}

function selectCoverage(db: Db, code: string) {
  return db
    .selectFrom('transit.mv_city_coverage')
    .select([
      'city_code as cityCode',
      'feed_version_id as feedVersionId',
      'hex_total as hexTotal',
      'hex_with_stop as hexWithStop',
      'stops',
      'routes',
      'trips',
    ])
    .where('city_code', '=', code)
    .orderBy('feed_version_id', 'desc')
    .executeTakeFirst();
}

/**
 * Replaces the boundary and the grid of a city: cells that are no longer inside are removed
 * (with their access stops), new cells are added. Returns the counts.
 */
export async function replaceGrid(
  db: Db,
  cityId: number,
  boundaryGeoJson: string,
  cells: readonly GridCell[],
): Promise<{ removed: number; added: number; total: number }> {
  await db
    .updateTable('transit.cities')
    .set({ bounds: sql<string>`ST_SetSRID(ST_GeomFromGeoJSON(${boundaryGeoJson}), 4326)` })
    .where('city_id', '=', cityId)
    .execute();
  const ids = cells.map((c) => c.h3);
  const removed = await db
    .deleteFrom('transit.hex_cells')
    .where('city_id', '=', cityId)
    .where(sql<boolean>`NOT (h3_index = ANY (${ids}::text[]))`)
    .executeTakeFirst();
  let added = 0;
  const chunk = 2_000;
  for (let i = 0; i < cells.length; i += chunk) {
    const part = cells.slice(i, i + chunk);
    const result = await sql`
      INSERT INTO transit.hex_cells (h3_index, city_id, centroid)
      SELECT h, ${cityId}, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
      FROM unnest(${part.map((c) => c.h3)}::text[], ${part.map((c) => c.lon)}::float8[], ${part.map((c) => c.lat)}::float8[])
           AS t(h, lon, lat)
      ON CONFLICT (h3_index) DO NOTHING`.execute(db);
    added += Number(result.numAffectedRows ?? 0n);
  }
  return { removed: Number(removed.numDeletedRows), added, total: cells.length };
}

/** Feed versions of a city whose access stops depend on the grid. */
export async function loadedFeedVersions(db: Db, cityId: number): Promise<number[]> {
  const rows = await db
    .selectFrom('transit.feed_versions as v')
    .innerJoin('transit.feed_sources as s', 's.feed_source_id', 'v.feed_source_id')
    .select('v.feed_version_id')
    .where('s.city_id', '=', cityId)
    .where('v.status', 'in', ['validated', 'active'])
    .execute();
  return rows.map((r) => r.feed_version_id);
}

export async function rebuildHexStopAccess(db: Db, feedVersionId: number): Promise<void> {
  await sql`CALL transit.rebuild_hex_stop_access(${feedVersionId})`.execute(db);
}
