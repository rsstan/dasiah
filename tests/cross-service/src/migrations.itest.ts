// Migrations of every service against a database that already holds data: later migrations keep
// the rows, every migration can be taken back and applied again, and taking all of them back
// leaves nothing behind.
import { startDatabase, type TestDatabase } from '@heatmap/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, SERVICES } from '../../../db/tools/migrations.ts';

let db: TestDatabase;

const run = (direction: 'up' | 'down', service: string, count = Number.POSITIVE_INFINITY) =>
  migrate({ connection: { connectionString: db.url('app_admin') }, direction, count, services: [service] });

async function count(sql: string): Promise<number> {
  const { rows } = await db.admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`);
  return rows[0]?.n ?? -1;
}

/** Objects (tables, views, sequences, functions, own types) of a schema, without the migration history. */
async function objects(schema: string): Promise<string[]> {
  const { rows } = await db.admin.query<{ name: string }>(
    `SELECT c.relkind::text || ' ' || c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r','v','m','S') AND c.relname NOT LIKE 'pgmigrations%'
      UNION ALL
     SELECT 'f ' || p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = $1
      UNION ALL
     SELECT 't ' || t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = $1 AND t.typtype IN ('d','e')
      ORDER BY 1`,
    [schema],
  );
  return rows.map((r) => r.name);
}

/** A row per service written while only its first migration is applied, and how to find it later. */
const DATA: Record<string, { write: string; find: string }> = {
  identity: {
    write: `INSERT INTO identity.roles (role_id, code, name) VALUES (1, 'user', 'User') ON CONFLICT DO NOTHING;
            INSERT INTO identity.users (email, password_hash) VALUES ('ann@example.com', '$argon2id$x');
            INSERT INTO identity.outbox (event_type, payload) VALUES ('identity.user.deleted.v1', '{"userId": "x"}')`,
    find: `identity.users, identity.outbox WHERE email = 'ANN@example.com' AND payload->>'userId' = 'x'`,
  },
  'transit-data': {
    write: `INSERT INTO transit.outbox (event_type, payload) VALUES ('transit.feed.activated.v1', '{"feedVersionId": 7}')`,
    find: `transit.outbox WHERE payload->>'feedVersionId' = '7'`,
  },
  accessibility: {
    write: `INSERT INTO accessibility.feed_snapshots (feed_version_id, city_code, valid_from, valid_to, is_current)
            VALUES (7, 'waw', '2026-11-01', '2027-03-31', true);
            INSERT INTO accessibility.outbox (event_type, payload)
            VALUES ('accessibility.calculation.completed.v1', '{"a": 1}')`,
    find: `accessibility.feed_snapshots, accessibility.outbox WHERE is_current AND payload->>'a' = '1'`,
  },
  places: {
    write: `INSERT INTO places.place_kinds (kind_id, code, label) VALUES (1, 'home', 'Home') ON CONFLICT DO NOTHING;
            INSERT INTO places.saved_places (user_id, kind_id, label, address_text, city_code, geom)
            VALUES (gen_random_uuid(), 1, 'Home', 'Prosta 1', 'waw', 'SRID=4326;POINT(21 52.2)')`,
    find: `places.saved_places WHERE label = 'Home' AND round(ST_X(geom::geometry)) = 21`,
  },
};

beforeAll(async () => {
  db = await startDatabase({ services: [] });
});
afterAll(() => db?.stop());

describe.each(SERVICES.map((s) => [s.service, s.schema] as const))('migrations of %s', (service, schema) => {
  const data = DATA[service] ?? { write: '', find: '' };

  it('keep rows written before the later migrations', async () => {
    await run('up', service, 1);
    await db.admin.query(data.write);
    expect(await count(data.find)).toBe(1);
    await run('up', service);
    expect(await count(data.find)).toBe(1);
  });

  it('do nothing when they are already applied', async () => {
    const before = await objects(schema);
    const applied: string[] = [];
    await migrate({
      connection: { connectionString: db.url('app_admin') },
      direction: 'up',
      count: Number.POSITIVE_INFINITY,
      services: [service],
      onApplied: (_, __, names) => applied.push(...names),
    });
    expect(applied).toEqual([]);
    expect(await objects(schema)).toEqual(before);
  });

  it('can be taken back to the first one and applied again without losing rows', async () => {
    const before = await objects(schema);
    const later = (await count(`${schema}.pgmigrations`)) - 1;
    await run('down', service, later);
    expect(await count(data.find)).toBe(1);
    await run('up', service);
    expect(await count(data.find)).toBe(1);
    expect(await objects(schema)).toEqual(before);
  });

  it('leave nothing behind when all are taken back', async () => {
    const before = await objects(schema);
    await run('down', service);
    expect(await objects(schema)).toEqual([]);
    await run('up', service);
    expect(await objects(schema)).toEqual(before);
  });
});

it('refuses an unknown service', async () => {
  await expect(run('up', 'nope')).rejects.toThrow(/Unknown service/);
});
