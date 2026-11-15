// places against a real database (bootstrap, migrations, svc_places) and RabbitMQ, with stand-ins
// for transit-data (GET /cities) and Photon: geocoding with cache and fallback, saved places with
// their limits and ownership, history filled from accessibility events, erasure on
// identity.user.deleted.v1. Response bodies are checked against contracts/openapi/places.yaml.
import { randomUUID } from 'node:crypto';
import { captureLogger } from '@heatmap/common/testing';
import { openApiDocuments, topology } from '@heatmap/contracts';
import {
  contractChecker,
  eventually,
  startBroker,
  startDatabase,
  type TestBroker,
  type TestDatabase,
} from '@heatmap/testing';
import amqp from 'amqplib';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createService, type Service } from './app.ts';
import { loadServiceConfig } from './config.ts';

const check = contractChecker(openApiDocuments.places);
const captured = captureLogger('places');

const VNO = { west: 25.0, south: 54.55, east: 25.5, north: 54.85 };
const ALICE = randomUUID();
const BOB = randomUUID();

let db: TestDatabase;
let broker: TestBroker;
let service: Service;
let stubs: FastifyInstance;
let stubUrl: string;
let channel: amqp.Channel;
let connection: amqp.ChannelModel;
/** Photon stand-in behaviour: 'ok' answers, 'down' answers 503. */
let photonMode: 'ok' | 'down' = 'ok';
const photonQueries: string[] = [];

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, userId?: string, body?: unknown) {
  return service.app.inject({
    method,
    url,
    headers: userId === undefined ? {} : { 'x-user-id': userId, 'x-user-role': 'user' },
    ...(body === undefined ? {} : { payload: body as object }),
  });
}

const place = (label: string, kind = 'other') => ({
  kind,
  label,
  addressText: 'Gedimino prospektas 9, Vilnius',
  cityCode: 'vno',
  location: { lat: 54.6872, lon: 25.2797 },
});

function publish(type: string, data: Record<string, unknown>, source: string): string {
  const id = randomUUID();
  const envelope = { id, type, source, time: new Date().toISOString(), correlationId: `it-${id}`, data };
  channel.publish(topology.exchange.name, type, Buffer.from(JSON.stringify(envelope)), {
    messageId: id,
    persistent: true,
    contentType: 'application/json',
  });
  return id;
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await db.admin.query<{ n: number }>(sql, params);
  return rows[0]?.n ?? -1;
}

beforeAll(async () => {
  stubs = Fastify();
  stubs.get('/cities', async () => ({
    items: [
      {
        code: 'vno',
        name: 'Vilnius',
        countryCode: 'LT',
        timezone: 'Europe/Vilnius',
        h3Resolution: 9,
        bounds: VNO,
        activeFeed: null,
      },
    ],
  }));
  stubs.get('/api', async (req, reply) => {
    const { q } = req.query as { q: string };
    photonQueries.push(q);
    if (photonMode === 'down') {
      return reply.status(503).send({ message: 'unavailable' });
    }
    return {
      features: [
        {
          geometry: { coordinates: [25.2797, 54.6872] },
          properties: { street: 'Gedimino prospektas', housenumber: '9', city: 'Vilnius' },
        },
        // Outside the city's box: dropped.
        { geometry: { coordinates: [21.0122, 52.2297] }, properties: { name: 'Warszawa' } },
      ],
    };
  });
  stubUrl = await stubs.listen({ host: '127.0.0.1', port: 0 });

  [db, broker] = await Promise.all([startDatabase({ services: ['places'], referenceData: ['places'] }), startBroker()]);
  connection = await amqp.connect(broker.url);
  channel = await connection.createChannel();

  const config = loadServiceConfig({
    SERVICE_NAME: 'places',
    PORT: '3004',
    LOG_LEVEL: 'debug',
    DATABASE_URL: db.url('svc_places'),
    AMQP_URL: broker.url,
    TRANSIT_URL: stubUrl,
    GEOCODER_URL: stubUrl,
    GEOCODER_MIN_INTERVAL_MS: '0',
  });
  service = await createService(config, captured.logger);
  await service.app.ready();
});

afterAll(async () => {
  await service?.app.close();
  await connection?.close();
  await stubs?.close();
  await Promise.all([db?.stop(), broker?.stop()]);
});

describe('geocoding', () => {
  it('asks the geocoder once, keeps the answer inside the city and serves it from the cache', async () => {
    const first = await call('GET', '/geocode?city=vno&q=Gedimino%20pr.%209');
    expect(first.statusCode).toBe(200);
    check('get', '/geocode', 200, first.json());
    expect(first.json().items).toEqual([{ displayName: 'Gedimino prospektas 9, Vilnius', lat: 54.6872, lon: 25.2797 }]);

    const again = await call('GET', '/geocode?city=vno&q=%20%20GEDIMINO%20PR.%20%209%20');
    expect(again.json().items[0].displayName).toBe('Gedimino prospektas 9, Vilnius');
    expect(photonQueries).toEqual(['Gedimino pr. 9']);
  });

  it('falls back to an expired cache entry while the geocoder is down, then answers 503', async () => {
    await db.admin.query(
      `UPDATE places.geocode_cache SET fetched_at = now() - interval '31 days', expires_at = now() - interval '1 day'`,
    );
    photonMode = 'down';
    try {
      const stale = await call('GET', '/geocode?city=vno&q=gedimino%20pr.%209');
      expect(stale.statusCode, stale.body).toBe(200);
      expect(stale.json().items[0].displayName).toBe('Gedimino prospektas 9, Vilnius');

      const missing = await call('GET', '/geocode?city=vno&q=Konstitucijos%20pr.%203');
      expect(missing.statusCode).toBe(503);
      expect(missing.json()).toMatchObject({ type: '/problems/geocoder-unavailable', status: 503 });
      expect(missing.headers['retry-after']).toBe('30');
    } finally {
      photonMode = 'ok';
    }
  });

  it('answers 404 for a city transit-data does not know and 400 for a bad query', async () => {
    const unknown = await call('GET', '/geocode?city=xyz&q=anything');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ type: '/problems/unknown-city' });
    expect((await call('GET', '/geocode?city=vno')).statusCode).toBe(400);
  });

  it('never logs the searched address', () => {
    const lines = JSON.stringify(captured.lines).toLowerCase();
    expect(lines).not.toContain('gedimino');
    expect(lines).not.toContain('konstitucijos');
  });
});

describe('saved places', () => {
  it('creates, lists, updates and deletes a place of the caller', async () => {
    const created = await call('POST', '/places', ALICE, place('Home', 'home'));
    expect(created.statusCode).toBe(201);
    check('post', '/places', 201, created.json());
    const id = created.json().placeId as string;
    expect(created.headers['location']).toBe(`/api/v1/places/${id}`);

    const list = await call('GET', '/places', ALICE);
    check('get', '/places', 200, list.json());
    expect(list.json().items.map((p: { label: string }) => p.label)).toEqual(['Home']);

    const updated = await call('PATCH', `/places/${id}`, ALICE, { label: 'Flat', location: { lat: 54.7, lon: 25.3 } });
    expect(updated.statusCode).toBe(200);
    check('patch', '/places/{id}', 200, updated.json());
    expect(updated.json()).toMatchObject({ label: 'Flat', kind: 'home', location: { lat: 54.7, lon: 25.3 } });

    expect((await call('DELETE', `/places/${id}`, ALICE)).statusCode).toBe(204);
    expect((await call('GET', '/places', ALICE)).json().items).toEqual([]);
  });

  it("hides another user's place: 404 on read paths, nothing changed", async () => {
    const id = (await call('POST', '/places', ALICE, place('Work', 'work'))).json().placeId as string;
    expect((await call('PATCH', `/places/${id}`, BOB, { label: 'Mine now' })).statusCode).toBe(404);
    expect((await call('DELETE', `/places/${id}`, BOB)).statusCode).toBe(404);
    expect((await call('GET', '/places', BOB)).json().items).toEqual([]);
    expect((await call('GET', '/places', ALICE)).json().items[0].label).toBe('Work');
  });

  it('refuses a duplicate label and a 21st place with 409', async () => {
    const dup = await call('POST', '/places', ALICE, place('Work'));
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ type: '/problems/duplicate-label' });

    for (let i = 2; i <= 20; i++) {
      expect((await call('POST', '/places', ALICE, place(`Place ${i}`))).statusCode).toBe(201);
    }
    const over = await call('POST', '/places', ALICE, place('One too many'));
    expect(over.statusCode).toBe(409);
    expect(over.json()).toMatchObject({ type: '/problems/place-limit' });
    check('post', '/places', 409, over.json());
  });

  it('requires a signed-in caller and validates the body', async () => {
    expect((await call('GET', '/places')).statusCode).toBe(401);
    const bad = await call('POST', '/places', BOB, { ...place('x'), kind: 'castle', location: { lat: 91, lon: 0 } });
    expect(bad.statusCode).toBe(400);
  });
});

describe('history and erasure (events)', () => {
  const origin = '891f2669803ffff';

  it('records completed calculations of signed-in users, newest first, with a cursor', async () => {
    const calc = [randomUUID(), randomUUID(), randomUUID()];
    for (const calculationId of calc) {
      publish(
        'accessibility.calculation.completed.v1',
        { calculationId, cityCode: 'vno', originH3: origin, userId: BOB, cacheHit: false },
        'accessibility',
      );
      await eventually('history row', async () => {
        const n = await count('SELECT count(*)::int AS n FROM places.search_history WHERE calculation_id = $1', [
          calculationId,
        ]);
        return n === 1;
      });
    }
    // Anonymous calculation: nothing stored.
    publish(
      'accessibility.calculation.completed.v1',
      { calculationId: randomUUID(), cityCode: 'vno', originH3: origin, userId: null, cacheHit: true },
      'accessibility',
    );

    const page1 = await call('GET', '/history?limit=2', BOB);
    expect(page1.statusCode).toBe(200);
    check('get', '/history', 200, page1.json());
    expect(page1.json().items.map((i: { calculationId: string }) => i.calculationId)).toEqual([calc[2], calc[1]]);
    const page2 = await call('GET', `/history?limit=2&cursor=${page1.json().nextCursor as string}`, BOB);
    expect(page2.json()).toEqual({ items: [expect.objectContaining({ calculationId: calc[0] })], nextCursor: null });
    expect((await call('GET', '/history?cursor=bm9wZQ', BOB)).statusCode).toBe(400);
    expect((await call('GET', '/history', ALICE)).json().items).toEqual([]);
  });

  it('erases places and history of a deleted user and nothing else', async () => {
    await call('POST', '/places', BOB, place('Gym'));
    publish('identity.user.deleted.v1', { userId: BOB }, 'identity');
    await eventually('bob erased', async () => {
      const n = await count(
        `SELECT (SELECT count(*) FROM places.saved_places WHERE user_id = $1)
              + (SELECT count(*) FROM places.search_history WHERE user_id = $1) AS n`,
        [BOB],
      );
      return Number(n) === 0;
    });
    expect((await call('GET', '/places', ALICE)).json().items).toHaveLength(20);
  });
});
