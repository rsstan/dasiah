// The main flow across three services, each with its own role and schema on one PostgreSQL and
// connected by one RabbitMQ: transit-data imports and activates a feed -> accessibility loads the
// timetable from the event -> a user computes a map -> places adds it to that user's history. Then
// a second feed version replaces the first while the service keeps running.
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createService as createAccessibility, type Service as Accessibility } from '@heatmap/accessibility/src/app.ts';
import { loadServiceConfig as accessibilityConfig } from '@heatmap/accessibility/src/config.ts';
import { startOsrmStub, type OsrmStub } from '@heatmap/accessibility/src/test-support/osrm-stub.ts';
import { transaction } from '@heatmap/common';
import { captureLogger } from '@heatmap/common/testing';
import { createService as createPlaces, type Service as Places } from '@heatmap/places/src/app.ts';
import { loadServiceConfig as placesConfig } from '@heatmap/places/src/config.ts';
import { eventually, startBroker, startDatabase, type TestBroker, type TestDatabase } from '@heatmap/testing';
import { createService as createTransit, type Service as Transit } from '@heatmap/transit-data/src/app.ts';
import { loadServiceConfig as transitConfig } from '@heatmap/transit-data/src/config.ts';
import { gridCells } from '@heatmap/transit-data/src/domain/grid.ts';
import { replaceGrid } from '@heatmap/transit-data/src/repositories/cities.ts';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import yazl from 'yazl';

const FIXTURE = resolve(import.meta.dirname, '../../../fixtures/gtfs/testville');
const ADMIN = { 'x-user-id': '00000000-0000-4000-8000-0000000000aa', 'x-user-role': 'admin' };
const USER = { 'x-user-id': '00000000-0000-4000-8000-0000000000bb', 'x-user-role': 'user' };
const REQUEST = { cityCode: 'waw', origin: { lat: 52.2, lon: 21.0 }, date: '2026-12-02', time: '07:58' };

let db: TestDatabase;
let broker: TestBroker;
let osrm: OsrmStub;
let publisher: FastifyInstance;
let transit: Transit;
let accessibility: Accessibility;
let places: Places;
let storage: string;
let archive: Buffer;

async function testville(change: (name: string, text: string) => string = (_, text) => text): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const name of (await readdir(FIXTURE)).filter((f) => f.endsWith('.txt'))) {
    zip.addBuffer(Buffer.from(change(name, await readFile(join(FIXTURE, name), 'utf8'))), name);
  }
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Imports what the publisher serves and activates it; returns the feed version. */
async function importAndActivate(): Promise<number> {
  const started = await transit.app.inject({
    method: 'POST',
    url: '/admin/feed-sources/waw_ztm/import',
    headers: ADMIN,
  });
  expect(started.statusCode).toBe(202);
  const id: number = started.json().feedVersionId;
  await eventually(
    'the import to be validated',
    async () =>
      (await transit.app.inject({ url: `/admin/feed-versions/${id}`, headers: ADMIN })).json().status === 'validated',
  );
  const activated = await transit.app.inject({
    method: 'POST',
    url: `/admin/feed-versions/${id}/activate`,
    headers: ADMIN,
  });
  expect(activated.json().status).toBe('active');
  return id;
}

const calculate = () =>
  accessibility.app.inject({ method: 'POST', url: '/calculations', payload: REQUEST, headers: USER });
const history = async (headers = USER): Promise<{ calculationId: string; cityCode: string }[]> =>
  (await places.app.inject({ url: '/history', headers })).json().items;

beforeAll(async () => {
  storage = await mkdtemp(join(tmpdir(), 'map-flow-'));
  [db, broker, osrm] = await Promise.all([
    startDatabase({
      services: ['transit-data', 'accessibility', 'places'],
      referenceData: ['transit', 'accessibility', 'places'],
    }),
    startBroker(),
    startOsrmStub(),
  ]);
  publisher = Fastify();
  publisher.get('/feed.zip', async (_req, reply) => reply.type('application/zip').send(archive));
  const publisherUrl = await publisher.listen({ port: 0, host: '127.0.0.1' });
  await db.admin.query(`UPDATE transit.feed_sources SET url = $1 WHERE code = 'waw_ztm'`, [`${publisherUrl}/feed.zip`]);

  const common = { AMQP_URL: broker.url, LOG_LEVEL: 'debug' };
  transit = await createTransit(
    transitConfig({
      ...common,
      SERVICE_NAME: 'transit-data',
      PORT: '3002',
      DATABASE_URL: db.url('svc_transit'),
      STORAGE_PATH: storage,
    }),
    captureLogger('transit-data').logger,
  );
  const transitUrl = await transit.app.listen({ port: 0, host: '127.0.0.1' });
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
  await transaction(transit.ctx.db, (trx) => replaceGrid(trx, 1, JSON.stringify(square), gridCells(square, 9)));

  accessibility = await createAccessibility(
    accessibilityConfig({
      ...common,
      SERVICE_NAME: 'accessibility',
      PORT: '3003',
      DATABASE_URL: db.url('svc_accessibility'),
      TRANSIT_URL: transitUrl,
      CITIES: 'waw',
      OSRM_URL_WAW: osrm.url,
      // Only the event may bring the timetable in this test.
      TIMETABLE_RETRY_MS: '3600000',
    }),
    captureLogger('accessibility').logger,
  );
  places = await createPlaces(
    placesConfig({
      ...common,
      SERVICE_NAME: 'places',
      PORT: '3004',
      DATABASE_URL: db.url('svc_places'),
      TRANSIT_URL: transitUrl,
    }),
    captureLogger('places').logger,
  );
  await Promise.all([accessibility.app.ready(), places.app.ready()]);
});

afterAll(async () => {
  await Promise.all([accessibility?.app.close(), places?.app.close()]);
  await transit?.app.close();
  await Promise.all([publisher?.close(), osrm?.close()]);
  await Promise.all([db?.stop(), broker?.stop()]);
  await rm(storage, { recursive: true, force: true });
});

describe('from a GTFS feed to the history of a user', () => {
  let first: { feedVersion: number; calculationId: string };

  it('cannot compute a map before a feed is active', async () => {
    expect((await calculate()).statusCode).toBe(503);
  });

  it('loads an activated feed through the event and computes a map of it', async () => {
    archive = await testville();
    const feedVersion = await importAndActivate();
    await eventually('the timetable', async () => (await calculate()).statusCode !== 503);
    const res = await calculate();
    expect(res.statusCode).toBe(200); // computed by the poll above, now from the cache
    expect(res.json()).toMatchObject({ status: 'done', feedVersionId: feedVersion });
    expect(res.json().cellCount).toBeGreaterThan(600);
    first = { feedVersion, calculationId: res.json().calculationId };
  });

  it('adds the map to the history of that user only, once', async () => {
    await eventually('the history entry', async () => (await history()).length > 0);
    expect(await history()).toMatchObject([{ calculationId: first.calculationId, cityCode: 'waw' }]);
    expect(await history(ADMIN)).toEqual([]);
  });

  it('switches to the next feed version without a restart; the old map stays readable', async () => {
    // The same network of a renamed agency: another archive, so another version.
    archive = await testville((name, text) =>
      name === 'agency.txt' ? text.replace(/Testville/g, 'Testville 2') : text,
    );
    const second = await importAndActivate();
    expect(second).toBeGreaterThan(first.feedVersion);
    await eventually('the new timetable', () => accessibility.ctx.timetables.current('waw')?.feedVersionId === second);
    const res = await calculate();
    expect(res.statusCode).toBe(201); // maps of the old version are not served for the new one
    expect(res.json().feedVersionId).toBe(second);
    const old = await accessibility.app.inject({ url: `/calculations/${first.calculationId}/results` });
    expect(old.statusCode).toBe(200);
    await eventually('the second history entry', async () => (await history()).length === 2);
  });
});
