// Right to erasure across services: identity and places run together on one PostgreSQL (each with
// its own svc_* role and schema) and one RabbitMQ. Deleting the account in identity must remove
// the user's saved places and history in places within seconds, through
// identity.user.deleted.v1 (outbox -> broker -> inbox), without any cross-schema access.
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { captureLogger } from '@heatmap/common/testing';
import { createIdentityService, type IdentityService } from '@heatmap/identity/src/app.ts';
import { loadServiceConfig as identityConfig } from '@heatmap/identity/src/config.ts';
import { createService as createPlaces, type Service as PlacesService } from '@heatmap/places/src/app.ts';
import { loadServiceConfig as placesConfig } from '@heatmap/places/src/config.ts';
import { startBroker, startDatabase, type TestBroker, type TestDatabase } from '@heatmap/testing';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: TestDatabase;
let broker: TestBroker;
let identity: IdentityService;
let places: PlacesService;
let transitStub: FastifyInstance;

const pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

beforeAll(async () => {
  [db, broker] = await Promise.all([
    startDatabase({ services: ['identity', 'places'], referenceData: ['identity', 'places'] }),
    startBroker(),
  ]);
  // places only needs transit-data for geocoding, which this test does not use.
  transitStub = Fastify();
  transitStub.get('/cities', async () => ({ items: [] }));
  const transitUrl = await transitStub.listen({ host: '127.0.0.1', port: 0 });

  identity = await createIdentityService(
    identityConfig({
      SERVICE_NAME: 'identity',
      PORT: '3001',
      DATABASE_URL: db.url('svc_identity'),
      AMQP_URL: broker.url,
      JWT_PRIVATE_KEY: pem,
      JWT_KEY_ID: 'e2e-key',
    }),
    captureLogger('identity').logger,
  );
  places = await createPlaces(
    placesConfig({
      SERVICE_NAME: 'places',
      PORT: '3004',
      DATABASE_URL: db.url('svc_places'),
      AMQP_URL: broker.url,
      TRANSIT_URL: transitUrl,
    }),
    captureLogger('places').logger,
  );
  await Promise.all([identity.app.ready(), places.app.ready()]);
});

afterAll(async () => {
  await identity?.app.close();
  await places?.app.close();
  await transitStub?.close();
  await Promise.all([db?.stop(), broker?.stop()]);
});

const as = (userId: string) => ({ 'x-user-id': userId, 'x-user-role': 'user' });

async function storedFor(userId: string): Promise<number> {
  const { rows } = await db.admin.query<{ n: number }>(
    `SELECT ((SELECT count(*) FROM places.saved_places WHERE user_id = $1)
           + (SELECT count(*) FROM places.search_history WHERE user_id = $1))::int AS n`,
    [userId],
  );
  return rows[0]?.n ?? -1;
}

describe('account deletion', () => {
  it("removes the user's places and history in places within seconds", async () => {
    const register = (email: string) =>
      identity.app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, password: 'correct horse battery staple' },
      });
    const leaving = (await register('leaving@example.com')).json<{ userId: string }>().userId;
    const staying = (await register('staying@example.com')).json<{ userId: string }>().userId;

    for (const [userId, label] of [
      [leaving, 'Home'],
      [leaving, 'Work'],
      [staying, 'Home'],
    ] as const) {
      const res = await places.app.inject({
        method: 'POST',
        url: '/places',
        headers: as(userId),
        payload: {
          kind: 'other',
          label,
          addressText: 'Gedimino prospektas 9, Vilnius',
          cityCode: 'vno',
          location: { lat: 54.6872, lon: 25.2797 },
        },
      });
      expect(res.statusCode).toBe(201);
    }
    // History as written by the accessibility consumer (the event path is covered in places.itest.ts).
    await db.admin.query(
      `INSERT INTO places.search_history (user_id, calculation_id, city_code, origin_h3) VALUES ($1, $2, 'vno', '891f2669803ffff')`,
      [leaving, randomUUID()],
    );
    expect(await storedFor(leaving)).toBe(3);

    const started = Date.now();
    const deleted = await identity.app.inject({ method: 'DELETE', url: '/users/me', headers: as(leaving) });
    expect(deleted.statusCode).toBe(204);

    while ((await storedFor(leaving)) > 0) {
      expect(Date.now() - started, 'erasure took too long').toBeLessThan(5_000);
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(await storedFor(staying)).toBe(1);
    const inbox = await db.admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM places.processed_messages`);
    expect(inbox.rows[0]?.n).toBe(1);
  });
});
