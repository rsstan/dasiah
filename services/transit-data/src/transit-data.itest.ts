// transit-data against a real database (bootstrap, migrations, svc_transit) and RabbitMQ, with a
// stub publisher serving zip archives built from fixtures/gtfs/testville.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { LightMyRequestResponse } from '@heatmap/common';
import { captureLogger } from '@heatmap/common/testing';
import { eventually, startBroker, startDatabase, type TestBroker, type TestDatabase } from '@heatmap/testing';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import { createService, type Service } from './app.ts';
import { gridCommand } from './cli/grid.ts';
import { importCommand } from './cli/import.ts';
import { loadServiceConfig } from './config.ts';
import { replaceGrid } from './repositories/cities.ts';
import { gridCells } from './domain/grid.ts';
import { transaction } from '@heatmap/common';
import type { Pattern } from './timetable/patterns.ts';

const FIXTURE = resolve(import.meta.dirname, '../../../fixtures/gtfs/testville');
const ADMIN = { 'x-user-id': '00000000-0000-4000-8000-0000000000aa', 'x-user-role': 'admin' };

let db: TestDatabase;
let broker: TestBroker;
let service: Service;
let publisher: FastifyInstance;
let storageDir: string;
/** What the stub publisher serves at /feed.zip. */
let served: { status: number; body: Buffer } = { status: 200, body: Buffer.alloc(0) };

async function zipOf(files: Record<string, string>): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const [name, content] of Object.entries(files)) {
    zip.addBuffer(Buffer.from(content), name);
  }
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function testvilleFiles(): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const name of (await readdir(FIXTURE)).filter((f) => f.endsWith('.txt'))) {
    files[name] = await readFile(join(FIXTURE, name), 'utf8');
  }
  return files;
}

const call = (
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> => service.app.inject({ method, url, headers });

async function importServed(): Promise<{
  status: number;
  body: { feedVersionId: number; status: string; duplicate: boolean };
}> {
  const res = await call('POST', '/admin/feed-sources/waw_ztm/import', ADMIN);
  return { status: res.statusCode, body: res.json() };
}

async function finalStatus(
  id: number,
): Promise<{ status: string; errorMessage: string | null; validFrom: string | null; validTo: string | null }> {
  let version = { status: 'downloaded', errorMessage: null, validFrom: null, validTo: null };
  await eventually('the import to finish', async () => {
    version = (await call('GET', `/admin/feed-versions/${id}`, ADMIN)).json();
    return !['downloading', 'downloaded', 'staged'].includes(version.status);
  });
  return version;
}

async function coreRows(feedVersionId: number): Promise<Record<string, number>> {
  const { rows } = await db.admin.query<Record<string, number>>(
    `SELECT (SELECT count(*) FROM transit.agencies WHERE feed_version_id = $1)::int AS agencies,
            (SELECT count(*) FROM transit.routes WHERE feed_version_id = $1)::int AS routes,
            (SELECT count(*) FROM transit.stops WHERE feed_version_id = $1)::int AS stops,
            (SELECT count(*) FROM transit.services WHERE feed_version_id = $1)::int AS services,
            (SELECT count(*) FROM transit.service_dates WHERE feed_version_id = $1)::int AS service_dates,
            (SELECT count(*) FROM transit.trips WHERE feed_version_id = $1)::int AS trips,
            (SELECT count(*) FROM transit.stop_times WHERE feed_version_id = $1)::int AS stop_times,
            (SELECT count(*) FROM transit.transfers WHERE feed_version_id = $1)::int AS transfers`,
    [feedVersionId],
  );
  return rows[0] ?? {};
}

async function stagingRows(): Promise<number> {
  const { rows } = await db.admin.query<{ n: number }>(
    `SELECT ((SELECT count(*) FROM transit_staging.stops) + (SELECT count(*) FROM transit_staging.stop_times)
           + (SELECT count(*) FROM transit_staging.trips))::int AS n`,
  );
  return rows[0]?.n ?? -1;
}

let good: number;

beforeAll(async () => {
  [db, broker] = await Promise.all([
    startDatabase({ services: ['transit-data'], referenceData: ['transit'] }),
    startBroker(),
  ]);
  publisher = Fastify();
  publisher.get('/feed.zip', async (_req, reply) =>
    reply.status(served.status).type('application/zip').send(served.body),
  );
  const publisherUrl = await publisher.listen({ port: 0, host: '127.0.0.1' });
  await db.admin.query(`UPDATE transit.feed_sources SET url = $1 WHERE code = 'waw_ztm'`, [`${publisherUrl}/feed.zip`]);

  storageDir = await mkdtemp(join(tmpdir(), 'transit-storage-'));
  const config = loadServiceConfig({
    SERVICE_NAME: 'transit-data',
    PORT: '3002',
    LOG_LEVEL: 'debug',
    DATABASE_URL: db.url('svc_transit'),
    AMQP_URL: broker.url,
    STORAGE_PATH: storageDir,
    DOWNLOAD_TIMEOUT_MS: '5000',
  });
  service = await createService(config, captureLogger('transit-data').logger);
  await service.app.ready();

  // Grid for Warsaw limited to the testville area (with a margin), as transit:grid would store it.
  const square = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [20.965, 52.163],
        [21.095, 52.163],
        [21.095, 52.232],
        [20.965, 52.232],
        [20.965, 52.163],
      ],
    ] as [number, number][][],
  };
  await transaction(service.ctx.db, (trx) => replaceGrid(trx, 1, JSON.stringify(square), gridCells(square, 9)));
});

afterAll(async () => {
  await service?.app.close();
  await publisher?.close();
  await Promise.all([db?.stop(), broker?.stop()]);
  await rm(storageDir, { recursive: true, force: true });
});

describe('cities', () => {
  it('lists the enabled cities with bounds and no active feed yet', async () => {
    const res = await call('GET', '/cities');
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((c: { code: string }) => c.code)).toEqual(['vno', 'waw']);
    expect(res.json().items[1]).toMatchObject({
      code: 'waw',
      timezone: 'Europe/Warsaw',
      h3Resolution: 9,
      activeFeed: null,
    });
    expect((await call('GET', '/cities/waw/coverage')).statusCode).toBe(404);
    expect((await call('GET', '/cities/xyz/coverage')).statusCode).toBe(404);
  });
});

describe('import', () => {
  it('imports testville through staging into the core tables with the expected rows', async () => {
    served = { status: 200, body: await zipOf(await testvilleFiles()) };
    const started = await importServed();
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({ status: 'downloading', duplicate: false });
    good = started.body.feedVersionId;

    const version = await finalStatus(good);
    expect(version).toMatchObject({
      status: 'validated',
      errorMessage: null,
      validFrom: '2026-11-01',
      validTo: '2027-03-31',
    });
    expect(await coreRows(good)).toEqual({
      agencies: 1,
      routes: 5,
      stops: 12,
      services: 2,
      service_dates: 151,
      trips: 19,
      stop_times: 77,
      transfers: 2,
    });
    expect(await stagingRows()).toBe(0);
    const access = await db.admin.query<{ n: number }>(
      'SELECT count(DISTINCT h3_index)::int AS n FROM transit.hex_stop_access WHERE feed_version_id = $1',
      [good],
    );
    expect(access.rows[0]?.n).toBeGreaterThan(100);
    const raw = await db.admin.query<{ storage_key: string }>(
      'SELECT storage_key FROM transit.feed_versions WHERE feed_version_id = $1',
      [good],
    );
    expect(await readFile(join(storageDir, raw.rows[0]?.storage_key ?? 'missing'))).toEqual(served.body);
  });

  it('treats a second import of the same archive as a no-op', async () => {
    const again = await importServed();
    expect(again.status).toBe(202);
    expect(await finalStatus(again.body.feedVersionId)).toMatchObject({
      status: 'failed',
      errorMessage: `Nothing new: the same archive as version ${good} (validated).`,
    });
    const fromFile = await service.importer.importFromFile(
      'waw_ztm',
      join(storageDir, `raw/waw_ztm`, (await readdir(join(storageDir, 'raw/waw_ztm')))[0] ?? ''),
    );
    expect(fromFile).toMatchObject({ feedVersionId: good, duplicate: true });
    const { rows } = await db.admin.query<{ n: number }>('SELECT count(*)::int AS n FROM transit.feed_versions');
    expect(rows[0]?.n).toBe(2); // the imported one and the attempt that found nothing new
  });

  it('ends a feed with dangling references as failed with nothing in the core tables', async () => {
    const files = await testvilleFiles();
    files['stop_times.txt'] = `${files['stop_times.txt'] ?? ''}R1_WK_0800,08:30:00,08:30:00,NO_SUCH_STOP,60,0\n`;
    served = { status: 200, body: await zipOf(files) };
    const started = await importServed();
    expect(started.status).toBe(202);
    const version = await finalStatus(started.body.feedVersionId);
    expect(version.status).toBe('failed');
    expect(version.errorMessage).toContain('stop_times rows reference unknown trips or stops');
    expect(Object.values(await coreRows(started.body.feedVersionId)).every((n) => n === 0)).toBe(true);
    expect(await stagingRows()).toBe(0);
    const activate = await call('POST', `/admin/feed-versions/${started.body.feedVersionId}/activate`, ADMIN);
    expect(activate.statusCode).toBe(409);
  });

  it('fails archives that are not GTFS: not a zip, a missing file', async () => {
    served = { status: 200, body: Buffer.from('this is not a zip archive at all') };
    const notZip = await importServed();
    expect((await finalStatus(notZip.body.feedVersionId)).errorMessage).toContain('not a readable zip archive');

    const { 'stop_times.txt': _drop, ...partial } = await testvilleFiles();
    served = { status: 200, body: await zipOf(partial) };
    const missing = await importServed();
    expect((await finalStatus(missing.body.feedVersionId)).errorMessage).toBe('required files missing: stop_times.txt');
  });

  it('ends as failed when the publisher fails; 404 for an unknown source, 403 without the admin role', async () => {
    served = { status: 404, body: Buffer.from('gone') };
    const gone = await importServed();
    expect(gone.status).toBe(202);
    expect((await finalStatus(gone.body.feedVersionId)).errorMessage).toContain('publisher answered 404');
    expect((await call('POST', '/admin/feed-sources/nope/import', ADMIN)).statusCode).toBe(404);
    expect((await call('POST', '/admin/feed-sources/waw_ztm/import', { 'x-user-role': 'user' })).statusCode).toBe(403);
    expect((await call('GET', '/admin/feed-versions', { 'x-user-role': 'user' })).statusCode).toBe(403);
  });

  it('lists versions newest first with a cursor', async () => {
    const first = await call('GET', '/admin/feed-versions?limit=2', ADMIN);
    expect(first.json().items).toHaveLength(2);
    const second = await call('GET', `/admin/feed-versions?limit=2&cursor=${first.json().nextCursor}`, ADMIN);
    const ids = [...first.json().items, ...second.json().items].map((v: { feedVersionId: number }) => v.feedVersionId);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(
      (await call('GET', '/admin/feed-versions?status=validated', ADMIN))
        .json()
        .items.map((v: { feedVersionId: number }) => v.feedVersionId),
    ).toEqual([good]);
  });
});

describe('activation', () => {
  it('activates a validated version, publishes transit.feed.activated.v1 and refreshes coverage', async () => {
    const next = await broker.listen('transit.feed.activated.v1');
    const res = await call('POST', `/admin/feed-versions/${good}/activate`, {
      ...ADMIN,
      'x-correlation-id': 'corr-activate-1',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ feedVersionId: good, status: 'active', cityCode: 'waw', sourceCode: 'waw_ztm' });
    const event = await next();
    expect(event.body).toMatchObject({
      type: 'transit.feed.activated.v1',
      source: 'transit-data',
      correlationId: 'corr-activate-1',
      data: { cityCode: 'waw', feedVersionId: good, validFrom: '2026-11-01', validTo: '2027-03-31' },
    });
    const coverage = (await call('GET', '/cities/waw/coverage')).json();
    expect(coverage).toMatchObject({ cityCode: 'waw', feedVersionId: good, stops: 12, routes: 5, trips: 19 });
    expect(coverage.hexWithStop).toBeGreaterThan(100);
    expect(coverage.hexTotal).toBeGreaterThan(coverage.hexWithStop);
    const city = (await call('GET', '/cities')).json().items[1];
    expect(city.activeFeed).toEqual({
      feedVersionId: good,
      cityCode: 'waw',
      validFrom: '2026-11-01',
      validTo: '2027-03-31',
    });
    expect((await call('POST', `/admin/feed-versions/${good}/activate`, ADMIN)).statusCode).toBe(409);
  });
});

describe('internal API', () => {
  const timetable = async (date: string, headers: Record<string, string> = {}) => {
    const res = await call('GET', `/internal/feed-versions/${good}/timetable?date=${date}`, {
      'accept-encoding': 'gzip',
      ...headers,
    });
    return { res, body: res.statusCode === 200 ? JSON.parse(gunzipSync(res.rawPayload).toString()) : undefined };
  };
  const firstDepartures = (patterns: Pattern[]) =>
    patterns.flatMap((p) => p.trips.map((t) => t[1] ?? 0)).sort((a, b) => a - b);

  it('serves the active feed of a city', async () => {
    expect((await call('GET', '/internal/cities/waw/active-feed')).json()).toMatchObject({ feedVersionId: good });
    expect((await call('GET', '/internal/cities/vno/active-feed')).statusCode).toBe(404);
  });

  it('builds the timetable of a weekday with non-overtaking patterns, cached with an ETag', async () => {
    const { res, body } = await timetable('2026-12-02');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(body).toMatchObject({ version: 1, feedVersionId: good, date: '2026-12-02' });
    expect(body.stops).toHaveLength(12);
    expect(body.transfers).toEqual([
      [expect.any(Number), expect.any(Number), 157],
      [expect.any(Number), expect.any(Number), 157],
    ]);
    // R1 east split in two by the overtaking slow trip, plus R1 west, R1X, R2 both ways, R3, R4.
    expect(body.patterns).toHaveLength(8);
    // 17 trips of Wednesday plus Tuesday's 23:50 trip, still running after midnight.
    expect(body.patterns.reduce((n: number, p: Pattern) => n + p.trips.length, 0)).toBe(18);
    for (const p of body.patterns as Pattern[]) {
      for (let i = 1; i < p.trips.length; i++) {
        const prev = p.trips[i - 1] ?? [];
        expect(p.trips[i]?.every((v, k) => v >= (prev[k] ?? 0))).toBe(true);
      }
    }
    const etag = String(res.headers['etag']);
    expect((await timetable('2026-12-02', { 'if-none-match': etag })).res.statusCode).toBe(304);
    const plain = await call('GET', `/internal/feed-versions/${good}/timetable?date=2026-12-02`);
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.json().patterns).toHaveLength(8);
  });

  it('adds the previous day trips that run past midnight and follows calendar exceptions', async () => {
    // Saturday: weekend trips at 09:00 and 10:00 plus Friday's 23:50 trip, shifted by -86 400.
    const saturday = (await timetable('2026-12-05')).body;
    expect(firstDepartures(saturday.patterns)).toEqual([23 * 3600 + 50 * 60 - 86_400, 9 * 3600, 10 * 3600]);
    // 2026-12-24: weekday service removed, weekend added; Wednesday's night trip still runs.
    const holiday = (await timetable('2026-12-24')).body;
    expect(firstDepartures(holiday.patterns)).toEqual([23 * 3600 + 50 * 60 - 86_400, 9 * 3600, 10 * 3600]);
    const outside = await timetable('2027-06-01');
    expect(outside.res.statusCode).toBe(422);
  });

  // accessibility tests RAPTOR against these files; they must be exactly what this service builds.
  // UPDATE_FIXTURES=1 rewrites them.
  it('builds the timetable artifacts committed in fixtures/gtfs/testville/artifacts', async () => {
    const dir = join(FIXTURE, 'artifacts');
    for (const date of ['2026-12-02', '2026-12-05', '2026-12-24']) {
      const built = { ...(await timetable(date)).body, feedVersionId: 1 };
      const file = join(dir, `timetable-${date}.json`);
      if (process.env['UPDATE_FIXTURES'] === '1') {
        await mkdir(dir, { recursive: true });
        await writeFile(file, `${JSON.stringify(built)}\n`);
      }
      expect(built).toEqual(JSON.parse(await readFile(file, 'utf8')));
    }
    const res = await call('GET', `/internal/feed-versions/${good}/hex-access`, { 'accept-encoding': 'gzip' });
    const access = { ...JSON.parse(gunzipSync(res.rawPayload).toString()), feedVersionId: 1 };
    const file = join(dir, 'hex-access.json');
    if (process.env['UPDATE_FIXTURES'] === '1') {
      await writeFile(file, `${JSON.stringify(access)}\n`);
    }
    expect(access).toEqual(JSON.parse(await readFile(file, 'utf8')));
  });

  it('serves the access stops of every cell of the grid', async () => {
    const res = await call('GET', `/internal/feed-versions/${good}/hex-access`, { 'accept-encoding': 'gzip' });
    const body = JSON.parse(gunzipSync(res.rawPayload).toString());
    expect(body).toMatchObject({ feedVersionId: good, cityCode: 'waw', resolution: 9 });
    const withStops = body.cells.filter((c: { stops: unknown[] }) => c.stops.length > 0);
    expect(withStops.length).toBeGreaterThan(100);
    expect(body.cells.length).toBeGreaterThan(withStops.length);
    for (const cell of withStops as { stops: [number, number][] }[]) {
      expect(cell.stops.length).toBeLessThanOrEqual(5);
      expect(cell.stops.map((s) => s[1])).toEqual([...cell.stops.map((s) => s[1])].sort((a, b) => a - b));
    }
  });
});

describe('unusual archives', () => {
  const imported = async (files: Record<string, string>) => {
    served = { status: 200, body: await zipOf(files) };
    const started = await importServed();
    return { id: started.body.feedVersionId, ...(await finalStatus(started.body.feedVersionId)) };
  };

  it('reads files in a sub-folder with Windows line ends, blank lines, quotes and other columns', async () => {
    const files = Object.fromEntries(
      Object.entries(await testvilleFiles()).map(([name, text]) => [
        `feed/${name}`,
        `${text.replace(/\r?\n/g, '\r\n')}\r\n\r\n`,
      ]),
    );
    const [header = '', first = '', ...rest] = (files['feed/agency.txt'] ?? '').split('\r\n');
    files['feed/agency.txt'] = [`${header},note`, `${first},"a ""quoted"", note"`, ...rest].join('\r\n');
    files['feed/unknown.txt'] = 'x';
    const version = await imported(files);
    expect(version).toMatchObject({ status: 'validated', errorMessage: null });
    expect(await coreRows(version.id)).toEqual(await coreRows(good));
  });

  it('needs calendar.txt or calendar_dates.txt, but not both', async () => {
    const files = await testvilleFiles();
    const { 'calendar.txt': _calendar, 'calendar_dates.txt': _dates, ...neither } = files;
    expect((await imported(neither)).errorMessage).toBe('required files missing: calendar.txt');
    const { 'calendar_dates.txt': _only, ...one } = files;
    expect((await imported(one)).status).toBe('validated');
  });

  it('refuses an empty file and text where a number belongs', async () => {
    const files = await testvilleFiles();
    expect((await imported({ ...files, 'trips.txt': '' })).errorMessage).toContain('trips.txt is empty');
    const broken = (files['stops.txt'] ?? '').replace(/52\.2\d*/, 'north');
    expect((await imported({ ...files, 'stops.txt': broken })).status).toBe('failed');
  });

  it('tries an archive again after it failed, as a new version', async () => {
    const { 'routes.txt': _routes, ...files } = await testvilleFiles();
    const first = await imported(files);
    const again = await importServed(); // byte for byte the same archive
    expect(again).toMatchObject({ status: 202, body: { duplicate: false } });
    expect(again.body.feedVersionId).toBeGreaterThan(first.id);
    expect([first.status, (await finalStatus(again.body.feedVersionId)).status]).toEqual(['failed', 'failed']);
    expect((await call('GET', `/admin/feed-versions/${first.id}`, ADMIN)).statusCode).toBe(404);
  });

  it('runs one import of a source at a time', async () => {
    const files = await testvilleFiles();
    served = { status: 200, body: await zipOf({ ...files, 'agency.txt': `${files['agency.txt'] ?? ''}\n` }) };
    const answers = await Promise.all([importServed(), importServed()]);
    expect(answers.map((a) => a.status).sort()).toEqual([202, 409]);
    await finalStatus(answers.find((a) => a.status === 202)?.body.feedVersionId ?? -1);
  });
});

describe('command line', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'transit-cli-'));
    env = {
      SERVICE_NAME: 'transit-data',
      PORT: '3002',
      LOG_LEVEL: 'fatal',
      DATABASE_URL: db.url('svc_transit'),
      AMQP_URL: broker.url,
      STORAGE_PATH: storageDir,
      INIT_CWD: dir,
    };
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('imports and activates a local archive', async () => {
    const files = await testvilleFiles();
    files['agency.txt'] = (files['agency.txt'] ?? '').replace('Testville Transit', 'Testville by hand');
    await writeFile(join(dir, 'feed.zip'), await zipOf(files));
    expect(await importCommand(['--source', 'waw_ztm', '--file', 'feed.zip', '--activate'], env)).toBe(0);
    const { rows } = await db.admin.query<{ name: string }>(
      `SELECT a.name FROM transit.agencies a JOIN transit.feed_versions v USING (feed_version_id) WHERE v.status = 'active'`,
    );
    expect(rows).toEqual([{ name: 'Testville by hand' }]);
    // The same archive again: nothing to do, still a success.
    expect(await importCommand(['--source', 'waw_ztm', '--file', 'feed.zip'], env)).toBe(0);
  });

  it('downloads from the publisher and reports a refused feed with exit code 2', async () => {
    served = { status: 200, body: Buffer.from('still not a zip') };
    expect(await importCommand(['--source', 'waw_ztm', '--download'], env)).toBe(2);
  });

  it.each([[[]], [['--source', 'waw_ztm']], [['--source', 'waw_ztm', '--download', '--file', 'x.zip']]])(
    'refuses the arguments %j',
    async (args) => {
      await expect(importCommand(args, env)).rejects.toThrow(/usage/);
    },
  );

  it('refuses an unknown source', async () => {
    await expect(importCommand(['--source', 'nope', '--download'], env)).rejects.toThrow(/Unknown feed source/);
  });

  it('replaces the grid of a city and rebuilds the access stops of its feeds', async () => {
    const cellCount = async () =>
      (await db.admin.query<{ n: number }>('SELECT count(*)::int AS n FROM transit.hex_cells WHERE city_id = 1'))
        .rows[0]?.n;
    const before = (await cellCount()) ?? 0;
    const ring = [
      [20.99, 52.19],
      [21.02, 52.19],
      [21.02, 52.21],
      [20.99, 52.21],
      [20.99, 52.19],
    ];
    const geometry = { type: 'Polygon', coordinates: [ring] };
    const file = join(dir, 'square.geojson');
    await writeFile(file, JSON.stringify({ type: 'Feature', geometry }));
    await gridCommand(['--city', 'waw', '--boundary', file], env);
    const feature = await cellCount();
    expect(feature).toBeGreaterThan(10);
    expect(feature).toBeLessThan(before);
    await writeFile(file, JSON.stringify(geometry)); // a bare geometry is the same boundary
    await gridCommand(['--city', 'waw', '--boundary', file], env);
    expect(await cellCount()).toBe(feature);
    const { rows } = await db.admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM transit.hex_stop_access a
        WHERE NOT EXISTS (SELECT 1 FROM transit.hex_cells c WHERE c.h3_index = a.h3_index)`,
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('refuses a grid without a city, for an unknown city or from a missing file', async () => {
    await expect(gridCommand([], env)).rejects.toThrow(/usage/);
    await expect(gridCommand(['--city', 'xxx'], env)).rejects.toThrow(/ENOENT/);
    await writeFile(join(dir, 'b.geojson'), JSON.stringify({ type: 'Polygon', coordinates: [[]] }));
    await expect(gridCommand(['--city', 'xxx', '--boundary', join(dir, 'b.geojson')], env)).rejects.toThrow(
      /unknown city xxx/,
    );
  });
});
