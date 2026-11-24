import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWithContext } from './context.ts';
import { assertServiceRole, createPool, isDatabaseOverload, UnsafeDatabaseRoleError, withTransaction } from './db.ts';

let container: StartedPostgreSqlContainer;
const pools: pg.Pool[] = [];

function poolAs(user: string, password = 'pw', statementTimeoutMs = 5_000): pg.Pool {
  const url = new URL(container.getConnectionUri());
  url.username = user;
  url.password = password;
  const pool = createPool({
    connectionString: url.toString(),
    applicationName: 'db-itest',
    statementTimeoutMs,
    max: 2,
  });
  pools.push(pool);
  return pool;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withTmpFs({ '/var/lib/postgresql/data': 'rw' })
    .withCommand(['postgres', '-c', 'fsync=off'])
    .start();
  const admin = poolAs(container.getUsername(), container.getPassword());
  await admin.query(`
    CREATE ROLE app_admin LOGIN PASSWORD 'pw';
    CREATE ROLE svc_sample LOGIN PASSWORD 'pw';
    CREATE ROLE sneaky LOGIN PASSWORD 'pw' IN ROLE app_admin;
    CREATE ROLE creator LOGIN PASSWORD 'pw' CREATEDB;
    GRANT CREATE ON SCHEMA public TO svc_sample; -- only for the rollback probe below
  `);
});

afterAll(async () => {
  await Promise.all(pools.map((p) => p.end()));
  await container?.stop();
});

describe('assertServiceRole', () => {
  it('accepts a plain service role', async () => {
    await expect(assertServiceRole(poolAs('svc_sample'))).resolves.toBe('svc_sample');
  });

  it.each([
    ['the superuser', () => container.getUsername(), () => container.getPassword(), 'is a superuser'],
    ['app_admin', () => 'app_admin', () => 'pw', 'member of it'],
    ['a member of app_admin', () => 'sneaky', () => 'pw', 'member of it'],
    ['a role with CREATEDB', () => 'creator', () => 'pw', 'CREATEDB'],
  ])('refuses %s', async (_label, user, password, reason) => {
    const error = await assertServiceRole(poolAs(user(), password())).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsafeDatabaseRoleError);
    expect((error as Error).message).toContain(reason);
  });
});

describe('pool and transactions', () => {
  it('applies the statement timeout to every connection', async () => {
    const error = await poolAs('svc_sample', 'pw', 200)
      .query('SELECT pg_sleep(1)')
      .catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe('57014'); // query_canceled
  });

  it('exposes the correlation id to SQL inside a transaction and rolls back on error', async () => {
    const pool = poolAs('svc_sample');
    const seen = await runWithContext({ correlationId: 'corr-db-1' }, () =>
      withTransaction(pool, async (client) => {
        const { rows } = await client.query<{ id: string | null }>(
          `SELECT current_setting('app.correlation_id', true) AS id`,
        );
        return rows[0]?.id;
      }),
    );
    expect(seen).toBe('corr-db-1');
    const after = await pool.query<{ id: string | null }>(`SELECT current_setting('app.correlation_id', true) AS id`);
    expect(after.rows[0]?.id ?? '').toBe(''); // transaction-local only

    await expect(
      withTransaction(pool, async (client) => {
        await client.query('CREATE TABLE tx_probe (x int)');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const exists = await pool.query(`SELECT to_regclass('public.tx_probe') AS t`);
    expect(exists.rows[0]?.t).toBeNull();
  });

  it('survives the server closing a connection that a transaction is using', async () => {
    const pool = poolAs('svc_sample');
    const admin = poolAs(container.getUsername(), container.getPassword());
    const failed = withTransaction(pool, async (client) => {
      const { rows } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const closed = new Promise((resolve) => client.once('end', resolve));
      await admin.query('SELECT pg_terminate_backend($1)', [rows[0]?.pid]);
      await closed; // busy elsewhere, not querying, when the connection goes away
      await client.query('SELECT 1');
    });
    await expect(failed).rejects.toThrow();
    // The process is alive and the pool hands out a working connection.
    expect((await pool.query<{ n: number }>('SELECT 1 AS n')).rows).toEqual([{ n: 1 }]);
  });

  it('tells overload of the database from other errors', async () => {
    const slow = await poolAs('svc_sample', 'pw', 100)
      .query('SELECT pg_sleep(1)')
      .catch((e: unknown) => e);
    expect(isDatabaseOverload(slow)).toBe(true);

    const url = new URL(container.getConnectionUri());
    const tiny = createPool({
      connectionString: url.toString(),
      applicationName: 'tiny',
      max: 1,
      connectTimeoutMs: 100,
    });
    pools.push(tiny);
    const held = await tiny.connect();
    const refused = await tiny.query('SELECT 1').catch((e: unknown) => e);
    held.release();
    expect(isDatabaseOverload(refused)).toBe(true);

    const broken = await tiny.query('SELECT nonsense').catch((e: unknown) => e);
    expect(isDatabaseOverload(broken)).toBe(false);
  });

  it('returns dates as strings and bigint counts as numbers', async () => {
    const { rows } = await poolAs('svc_sample').query<{ d: unknown; n: unknown }>(
      `SELECT date '2026-12-02' AS d, count(*) AS n FROM generate_series(1, 3)`,
    );
    expect(rows[0]).toEqual({ d: '2026-12-02', n: 3 });
  });
});
