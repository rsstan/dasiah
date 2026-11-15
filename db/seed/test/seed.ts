// Test and demo data. Runs as app_admin (operator tooling, so it may touch every schema).
//
//   pnpm db:seed:test          (= scripts/with-env.sh node db/seed/test/seed.ts)
//
// 1. Imports fixtures/gtfs/testville for source waw_ztm the same way the service does:
//    feed_versions row -> transit_staging -> promote_feed -> rebuild_transfers ->
//    rebuild_hex_stop_access -> activate_feed. A grid of H3 cells around the feed is
//    generated first (cells with and without access stops).
// 2. Demo accounts (user, admin, a user at the 20-place limit, an anonymised user) with
//    Argon2id hashes computed now from SEED_DEMO_PASSWORD (random if unset).
// 3. Saved places, search history, geocoder cache (fresh and expired), calculations
//    (fresh, expired, failed) whose results cover every legend class.
//
// Repeatable: the feed is imported once (matched by content hash); rows owned by the seed
// have fixed ids and are replaced on every run.
import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cellToLatLng, greatCircleDistance, latLngToCell, polygonToCells } from 'h3-js';
import pg from 'pg';
import { hashPassword } from '../../../services/identity/src/domain/password.ts';
import { parseCsv } from './csv.ts';

const FIXTURE_DIR = resolve(import.meta.dirname, '../../../fixtures/gtfs/testville');
const SOURCE_CODE = 'waw_ztm';
const CITY_CODE = 'waw';
const GRID_MARGIN_DEG = { lat: 0.022, lon: 0.035 }; // about 2.4 km around the stops
const STAGING_FILES: Record<string, string> = {
  agency: 'agency.txt',
  routes: 'routes.txt',
  stops: 'stops.txt',
  trips: 'trips.txt',
  stop_times: 'stop_times.txt',
  calendar: 'calendar.txt',
  calendar_dates: 'calendar_dates.txt',
};

const USER = {
  demo: 'a0000000-0000-4000-8000-000000000001',
  admin: 'a0000000-0000-4000-8000-000000000002',
  full: 'a0000000-0000-4000-8000-000000000003',
  anonymised: 'a0000000-0000-4000-8000-000000000004',
} as const;
const CALC = {
  fresh: 'c0000000-0000-4000-8000-000000000001',
  expired: 'c0000000-0000-4000-8000-000000000002',
  failed: 'c0000000-0000-4000-8000-000000000003',
} as const;
const ORIGIN = { lat: 52.2, lon: 21.0 }; // stop A, Alpha Square
const SERVICE_DATE = '2026-12-02';

type Client = pg.PoolClient;

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

async function inTransaction<T>(client: Client, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** Multi-row INSERT with positional parameters. */
async function insertRows(client: Client, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const params: unknown[] = [];
    const tuples = part.map((row) => `(${row.map((value) => `$${params.push(value)}`).join(', ')})`);
    await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`, params);
  }
}

// ------------------------------------------------------------------ feed

function fixtureHash(): Buffer {
  const hash = createHash('sha256');
  for (const name of readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.txt'))
    .sort()) {
    hash
      .update(name)
      .update('\0')
      .update(readFileSync(resolve(FIXTURE_DIR, name)))
      .update('\0');
  }
  return hash.digest();
}

async function ensureGrid(client: Client, cityId: number, resolution: number): Promise<number> {
  const stops = parseCsv(readFileSync(resolve(FIXTURE_DIR, 'stops.txt'), 'utf8'));
  const lats = stops.map((s) => Number(s['stop_lat']));
  const lons = stops.map((s) => Number(s['stop_lon']));
  const [south, north] = [Math.min(...lats) - GRID_MARGIN_DEG.lat, Math.max(...lats) + GRID_MARGIN_DEG.lat];
  const [west, east] = [Math.min(...lons) - GRID_MARGIN_DEG.lon, Math.max(...lons) + GRID_MARGIN_DEG.lon];
  const cells = polygonToCells(
    [
      [south, west],
      [south, east],
      [north, east],
      [north, west],
      [south, west],
    ],
    resolution,
  );
  const rows = cells.map((h3) => {
    const [lat, lon] = cellToLatLng(h3);
    return [h3, cityId, `SRID=4326;POINT(${lon} ${lat})`];
  });
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const params: unknown[] = [];
    const tuples = part.map((r) => `($${params.push(r[0])}, $${params.push(r[1])}, $${params.push(r[2])}::geography)`);
    await client.query(
      `INSERT INTO transit.hex_cells (h3_index, city_id, centroid) VALUES ${tuples.join(', ')} ON CONFLICT (h3_index) DO NOTHING`,
      params,
    );
  }
  return cells.length;
}

async function stageFile(client: Client, feedVersionId: number, table: string, file: string): Promise<number> {
  const { rows: cols } = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'transit_staging' AND table_name = $1 AND column_name <> 'feed_version_id'
      ORDER BY ordinal_position`,
    [table],
  );
  const columns = cols.map((c) => c.column_name);
  const records = parseCsv(readFileSync(resolve(FIXTURE_DIR, file), 'utf8'));
  await insertRows(
    client,
    `transit_staging.${table}`,
    ['feed_version_id', ...columns],
    records.map((r) => [feedVersionId, ...columns.map((c) => r[c] ?? null)]),
  );
  return records.length;
}

async function importTestville(client: Client): Promise<number> {
  const sha = fixtureHash();
  const source = await client.query<{ feed_source_id: number; city_id: number; h3_resolution: number }>(
    `SELECT fs.feed_source_id, c.city_id, c.h3_resolution
       FROM transit.feed_sources fs JOIN transit.cities c USING (city_id) WHERE fs.code = $1`,
    [SOURCE_CODE],
  );
  const src = source.rows[0];
  if (src === undefined) {
    throw new Error(`feed source ${SOURCE_CODE} not found: run pnpm db:seed first`);
  }

  const cells = await inTransaction(client, () => ensureGrid(client, src.city_id, src.h3_resolution));
  console.log(`grid: ${cells} cells around testville (resolution ${src.h3_resolution})`);

  const existing = await client.query<{ feed_version_id: number; status: string }>(
    'SELECT feed_version_id, status FROM transit.feed_versions WHERE feed_source_id = $1 AND sha256 = $2',
    [src.feed_source_id, sha],
  );
  let fv = existing.rows[0]?.feed_version_id;
  let status = existing.rows[0]?.status;
  if (fv !== undefined && (status === 'downloaded' || status === 'staged' || status === 'failed')) {
    // Left over from an interrupted run: start again.
    await client.query('DELETE FROM transit.feed_versions WHERE feed_version_id = $1', [fv]);
    for (const table of Object.keys(STAGING_FILES)) {
      await client.query(`DELETE FROM transit_staging.${table} WHERE feed_version_id = $1`, [fv]);
    }
    fv = undefined;
  }

  if (fv === undefined) {
    const newFv = await inTransaction(client, async () => {
      const { rows } = await client.query<{ feed_version_id: number }>(
        `INSERT INTO transit.feed_versions (feed_source_id, sha256, storage_key)
         VALUES ($1, $2, 'fixtures/gtfs/testville') RETURNING feed_version_id`,
        [src.feed_source_id, sha],
      );
      const id = rows[0]?.feed_version_id;
      if (id === undefined) {
        throw new Error('feed_versions insert returned no row');
      }
      for (const [table, file] of Object.entries(STAGING_FILES)) {
        const n = await stageFile(client, id, table, file);
        console.log(`staged ${file}: ${n} rows`);
      }
      await client.query(`UPDATE transit.feed_versions SET status = 'staged' WHERE feed_version_id = $1`, [id]);
      return id;
    });
    try {
      await inTransaction(client, async () => {
        await client.query('CALL transit.promote_feed($1)', [newFv]);
        await client.query('CALL transit.rebuild_transfers($1)', [newFv]);
        await client.query('CALL transit.rebuild_hex_stop_access($1)', [newFv]);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await client.query(
        `UPDATE transit.feed_versions SET status = 'failed', error_message = $2 WHERE feed_version_id = $1`,
        [newFv, message],
      );
      throw error;
    }
    fv = newFv;
    status = 'validated';
    console.log(`feed version ${fv}: promoted`);
  }

  if (status === 'validated') {
    await client.query('CALL transit.activate_feed($1)', [fv]);
    console.log(`feed version ${fv}: activated for ${CITY_CODE}`);
  } else {
    console.log(`feed version ${fv}: already ${status}`);
  }
  return fv;
}

// ------------------------------------------------------------------ identity

async function seedIdentity(client: Client): Promise<void> {
  let password = process.env['SEED_DEMO_PASSWORD'] ?? '';
  const generated = password === '';
  if (generated) {
    password = randomBytes(12).toString('base64url');
  }
  const accounts = [
    { id: USER.demo, email: 'demo.user@example.com', name: 'Demo User', role: 1 },
    { id: USER.admin, email: 'demo.admin@example.com', name: 'Demo Admin', role: 2 },
    { id: USER.full, email: 'full.places@example.com', name: 'Full Places', role: 1 },
    { id: USER.anonymised, email: 'to.delete@example.com', name: 'Gone Soon', role: 1 },
  ];
  let created = 0;
  for (const a of accounts) {
    const hash = await hashPassword(password);
    const { rowCount } = await client.query(
      `INSERT INTO identity.users (user_id, email, password_hash, display_name, role_id, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, now()) ON CONFLICT (user_id) DO NOTHING`,
      [a.id, a.email, hash, a.name, a.role],
    );
    if (rowCount === 1) {
      created++;
      // IPs from the documentation ranges (RFC 5737).
      await client.query(
        `INSERT INTO identity.audit_log (user_id, event_type_id, ip)
         SELECT $1, event_type_id, '192.0.2.10'::inet FROM identity.audit_event_types WHERE code = 'login_succeeded'`,
        [a.id],
      );
    }
  }
  if (created > 0) {
    await client.query(
      `INSERT INTO identity.audit_log (user_id, event_type_id, ip)
       SELECT NULL, event_type_id, '198.51.100.7'::inet FROM identity.audit_event_types WHERE code = 'login_failed'`,
    );
  }
  const anonymised = await client.query('SELECT 1 FROM identity.users WHERE user_id = $1 AND deleted_at IS NOT NULL', [
    USER.anonymised,
  ]);
  if (anonymised.rowCount === 0) {
    await client.query('CALL identity.anonymize_user($1)', [USER.anonymised]);
  }
  // One expired, revoked session (expired-row case for clean-up jobs).
  await client.query(
    `INSERT INTO identity.refresh_tokens (token_id, user_id, token_hash, issued_at, expires_at, revoked_at, user_agent)
     VALUES ('b0000000-0000-4000-8000-000000000001', $1, sha256('seed expired token'), now() - interval '40 days',
             now() - interval '10 days', now() - interval '10 days', 'seed')
     ON CONFLICT (token_id) DO NOTHING`,
    [USER.demo],
  );
  if (created > 0) {
    console.log(
      generated
        ? `identity: ${created} demo accounts created; generated password (set SEED_DEMO_PASSWORD to choose one): ${password}`
        : `identity: ${created} demo accounts created with SEED_DEMO_PASSWORD`,
    );
  } else {
    console.log('identity: demo accounts already present');
  }
}

// ------------------------------------------------------------------ places

const point = (lat: number, lon: number): string => `SRID=4326;POINT(${lon} ${lat})`;

async function seedPlaces(client: Client): Promise<void> {
  await client.query('SELECT places.erase_user(u) FROM unnest($1::uuid[]) u', [[USER.demo, USER.full, USER.admin]]);
  const demoPlaces = [
    [USER.demo, 1, 'Home', '1 Alpha Square, Testville', CITY_CODE, point(52.2003, 21.0004)],
    [USER.demo, 2, 'Work', '12 East End Road, Testville', CITY_CODE, point(52.2002, 21.0597)],
    [USER.demo, 3, 'University', '3 Fern Hill, Testville', CITY_CODE, point(52.2091, 21.0302)],
  ];
  const fullPlaces = Array.from({ length: 20 }, (_, i) => [
    USER.full,
    4,
    `Place ${String(i + 1).padStart(2, '0')}`,
    `${i + 1} Grid Lane, Testville`,
    CITY_CODE,
    point(52.19 + (i % 5) * 0.005, 21.0 + Math.floor(i / 5) * 0.015),
  ]);
  for (const row of [...demoPlaces, ...fullPlaces]) {
    await client.query(
      `INSERT INTO places.saved_places (user_id, kind_id, label, address_text, city_code, geom)
       VALUES ($1, $2, $3, $4, $5, $6::geography)`,
      row,
    );
  }
  const history = [
    [USER.demo, CALC.fresh, "now() - interval '5 minutes'"],
    [USER.demo, CALC.expired, "now() - interval '2 days'"],
  ] as const;
  const originH3 = latLngToCell(ORIGIN.lat, ORIGIN.lon, 10);
  for (const [user, calc, at] of history) {
    await client.query(
      `INSERT INTO places.search_history (user_id, calculation_id, city_code, origin_h3, created_at)
       VALUES ($1, $2, $3, $4, ${at})`,
      [user, calc, CITY_CODE, originH3],
    );
  }
  await client.query(
    `INSERT INTO places.geocode_cache (city_code, query_norm, display_name, geom, provider, fetched_at, expires_at) VALUES
       ($1, 'alpha square', 'Alpha Square, Testville', $2::geography, 'photon', now(), now() + interval '30 days'),
       ($1, 'old harbour road', 'Old Harbour Road, Testville', $3::geography, 'photon',
        now() - interval '40 days', now() - interval '10 days')
     ON CONFLICT (city_code, query_norm) DO UPDATE
       SET display_name = EXCLUDED.display_name, geom = EXCLUDED.geom,
           fetched_at = EXCLUDED.fetched_at, expires_at = EXCLUDED.expires_at`,
    [CITY_CODE, point(52.2, 21.0), point(52.2015, 21.045)],
  );
  console.log(
    `places: ${demoPlaces.length + fullPlaces.length} saved places, ${history.length} history rows, 2 geocoder entries`,
  );
}

// ------------------------------------------------------------------ accessibility

/** Ratio bands by distance from the origin; chosen so that every legend class appears. */
function syntheticResult(distM: number, hasStop: boolean): { transit: number | null; car: number } {
  const car = Math.max(60, Math.round(90 + distM / 9)); // about 32 km/h plus parking
  if (!hasStop) {
    return { transit: null, car };
  }
  const ratio =
    distM < 1000 ? 1.0 : distM < 2000 ? 1.4 : distM < 3000 ? 1.8 : distM < 4000 ? 2.5 : distM < 5000 ? 3.5 : null;
  return { transit: ratio === null ? null : Math.round(car * ratio), car };
}

async function seedAccessibility(client: Client, fv: number): Promise<void> {
  const algoVersion = Number(env('ALGO_VERSION', '1'));
  await client.query(
    `INSERT INTO accessibility.feed_snapshots (feed_version_id, city_code, valid_from, valid_to, is_current)
     SELECT feed_version_id, $2, valid_from, valid_to, true FROM transit.feed_versions WHERE feed_version_id = $1
     ON CONFLICT (feed_version_id) DO UPDATE SET is_current = true`,
    [fv, CITY_CODE],
  );
  await client.query('DELETE FROM accessibility.calculations WHERE calculation_id = ANY ($1::uuid[])', [
    Object.values(CALC),
  ]);
  const originH3 = latLngToCell(ORIGIN.lat, ORIGIN.lon, 10);
  const insertCalc = `INSERT INTO accessibility.calculations
      (calculation_id, feed_version_id, origin_h3, service_date, departure_s, window_s, algo_version,
       status, created_at, completed_at, expires_at, error_code)
    VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, $11)`;
  const now = Date.now();
  const at = (offsetMs: number): Date => new Date(now + offsetMs);
  const HOUR = 3_600_000;
  const calcs = [
    // id, departure_s, status, created_at, completed_at, expires_at, error_code
    [CALC.fresh, 8 * 3600, 'done', at(-300_000), at(-297_000), at(24 * HOUR), null],
    [CALC.expired, 8 * 3600 + 1800, 'done', at(-48 * HOUR), at(-48 * HOUR + 4_000), at(-24 * HOUR), null],
    [CALC.failed, 9 * 3600, 'failed', at(-HOUR), at(-HOUR + 10_000), at(23 * HOUR), 'osrm_unavailable'],
  ] as const;
  for (const [id, departure, status, created, completed, expires, error] of calcs) {
    await client.query(insertCalc, [
      id,
      fv,
      originH3,
      SERVICE_DATE,
      departure,
      algoVersion,
      status,
      created,
      completed,
      expires,
      error,
    ]);
  }

  const { rows: cells } = await client.query<{ h3_index: string; has_stop: boolean }>(
    `SELECT h.h3_index, EXISTS (SELECT 1 FROM transit.hex_stop_access a
                                 WHERE a.feed_version_id = $1 AND a.h3_index = h.h3_index) AS has_stop
       FROM transit.hex_cells h JOIN transit.cities c USING (city_id)
      WHERE c.code = $2 ORDER BY h.h3_index`,
    [fv, CITY_CODE],
  );
  const results = (calc: string, maxDist: number): unknown[][] =>
    cells.flatMap(({ h3_index, has_stop }) => {
      const dist = greatCircleDistance([ORIGIN.lat, ORIGIN.lon], cellToLatLng(h3_index), 'm');
      if (dist > maxDist) {
        return [];
      }
      const r = syntheticResult(dist, has_stop);
      return [[calc, h3_index, r.transit, r.car, has_stop]];
    });
  const cols = ['calculation_id', 'h3_index', 'transit_s', 'car_s', 'has_stop'];
  await insertRows(client, 'accessibility.calculation_results', cols, results(CALC.fresh, Infinity));
  await insertRows(client, 'accessibility.calculation_results', cols, results(CALC.expired, 2500));

  const { rows: classes } = await client.query<{ class_code: string; n: string }>(
    `SELECT class_code, count(*) AS n FROM accessibility.v_calculation_results
      WHERE calculation_id = $1 GROUP BY class_code ORDER BY class_code`,
    [CALC.fresh],
  );
  const { rows: all } = await client.query<{ code: string }>('SELECT code FROM accessibility.ratio_classes');
  const missing = all.map((c) => c.code).filter((code) => !classes.some((c) => c.class_code === code));
  if (missing.length > 0) {
    throw new Error(`seeded results do not cover legend classes: ${missing.join(', ')}`);
  }
  console.log(
    `accessibility: 3 calculations; fresh one per class: ${classes.map((c) => `${c.class_code}=${c.n}`).join(' ')}`,
  );
}

// ------------------------------------------------------------------ main

async function main(): Promise<void> {
  const pool = new pg.Pool({
    host: env('PGHOST', 'localhost'),
    port: Number(env('PGPORT', '5432')),
    database: env('PGDATABASE', 'heatmap'),
    user: 'app_admin',
    password: env('DB_PASSWORD_APP_ADMIN'),
    max: 1,
  });
  const client = await pool.connect();
  try {
    const fv = await importTestville(client);
    await inTransaction(client, async () => {
      await seedIdentity(client);
      await seedPlaces(client);
      await seedAccessibility(client, fv);
    });
    const { rows } = await client.query<{ city_code: string; feed_version_id: number }>(
      'SELECT city_code, feed_version_id FROM transit.v_active_feeds WHERE city_code = $1',
      [CITY_CODE],
    );
    console.log(`active feed for ${CITY_CODE}: ${rows.map((r) => r.feed_version_id).join(', ') || 'none'}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
