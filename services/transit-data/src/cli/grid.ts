// Builds the H3 grid of a city from its boundary and stores it (as svc_transit).
//
//   pnpm transit:grid --city waw [--boundary db/seed/reference/boundaries/waw.geojson]
//
// Replaces cities.bounds with the boundary polygon, adds and removes cells, then recomputes the
// access stops of every validated or active feed version of the city. The coverage view is
// refreshed with the next activation.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { assertServiceRole, createKysely, createLogger, createPool, transaction } from '@heatmap/common';
import { loadServiceConfig } from '../config.ts';
import { gridCells, type GeoJsonPolygon } from '../domain/grid.ts';
import { findCity, loadedFeedVersions, rebuildHexStopAccess, replaceGrid } from '../repositories/cities.ts';
import type { TransitDb } from '../repositories/schema.ts';

const ROOT = resolve(import.meta.dirname, '../../../..');

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { city: { type: 'string' }, boundary: { type: 'string' } } });
  const code = values.city;
  if (code === undefined) {
    throw new Error('usage: pnpm transit:grid --city <code> [--boundary <file.geojson>]');
  }
  const config = loadServiceConfig();
  const logger = createLogger({ service: 'transit-grid', level: config.LOG_LEVEL });
  const file = values.boundary ?? resolve(ROOT, 'db/seed/reference/boundaries', `${code}.geojson`);
  const feature = JSON.parse(readFileSync(file, 'utf8')) as { geometry?: GeoJsonPolygon } & GeoJsonPolygon;
  const boundary = feature.geometry ?? feature;

  const pool = createPool({
    connectionString: config.DATABASE_URL,
    applicationName: 'transit-grid',
    statementTimeoutMs: config.IMPORT_STATEMENT_TIMEOUT_MS,
  });
  try {
    await assertServiceRole(pool);
    const db = createKysely<TransitDb>(pool);
    const city = await findCity(db, code);
    if (city === undefined) {
      throw new Error(`unknown city ${code}`);
    }
    const cells = gridCells(boundary, city.h3Resolution);
    const counts = await transaction(db, async (trx) => {
      const changed = await replaceGrid(trx, city.cityId, JSON.stringify(boundary), cells);
      const feeds = await loadedFeedVersions(trx, city.cityId);
      for (const fv of feeds) {
        await rebuildHexStopAccess(trx, fv);
      }
      return { ...changed, feedsRebuilt: feeds };
    });
    logger.info({ city: code, resolution: city.h3Resolution, ...counts }, 'grid stored');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
