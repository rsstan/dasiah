// PostgreSQL access for services: one pool per service, a statement timeout on every
// connection, a start-up guard against privileged roles, Kysely on top, and a transaction
// helper that records the correlation id for the outbox.
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { currentCorrelationId } from './context.ts';
import { injectTraceHeaders } from './tracing.ts';

// Dates stay 'YYYY-MM-DD' strings (no time-zone shift through JS Date); bigint counts become numbers.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`int8 value ${value} exceeds the safe integer range`);
  }
  return n;
});

export interface PoolOptions {
  readonly connectionString: string;
  readonly applicationName: string;
  readonly max?: number;
  readonly statementTimeoutMs?: number;
}

export function createPool({
  connectionString,
  applicationName,
  max = 10,
  statementTimeoutMs = 5_000,
}: PoolOptions): pg.Pool {
  return new pg.Pool({
    connectionString,
    application_name: applicationName,
    max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    options: `-c statement_timeout=${statementTimeoutMs} -c idle_in_transaction_session_timeout=${statementTimeoutMs * 6}`,
  });
}

export class UnsafeDatabaseRoleError extends Error {
  constructor(role: string, reason: string) {
    super(`Refusing to start: database role "${role}" ${reason}. Services connect as their own svc_* role.`);
    this.name = 'UnsafeDatabaseRoleError';
  }
}

/**
 * Checks the role the pool connects as. Throws when it is a superuser, can create roles or
 * databases, bypasses row security, is app_admin (owner of the schemas) or a member of it.
 * Returns the role name.
 */
export async function assertServiceRole(pool: pg.Pool): Promise<string> {
  const { rows } = await pool.query<{
    rolname: string;
    rolsuper: boolean;
    rolcreaterole: boolean;
    rolcreatedb: boolean;
    rolbypassrls: boolean;
    admin_member: boolean;
  }>(
    `SELECT r.rolname, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls,
            EXISTS (SELECT 1 FROM pg_roles a WHERE a.rolname = 'app_admin' AND pg_has_role(r.oid, a.oid, 'MEMBER')) AS admin_member
       FROM pg_roles r WHERE r.rolname = current_user`,
  );
  const role = rows[0];
  if (role === undefined) {
    throw new UnsafeDatabaseRoleError('?', 'could not be inspected');
  }
  if (role.rolsuper) {
    throw new UnsafeDatabaseRoleError(role.rolname, 'is a superuser');
  }
  if (role.rolcreaterole || role.rolcreatedb || role.rolbypassrls) {
    throw new UnsafeDatabaseRoleError(role.rolname, 'has CREATEROLE, CREATEDB or BYPASSRLS');
  }
  if (role.admin_member) {
    throw new UnsafeDatabaseRoleError(role.rolname, 'is app_admin or a member of it (migration role)');
  }
  return role.rolname;
}

/** Readiness check: one round trip. */
export async function pingDatabase(pool: pg.Pool): Promise<void> {
  await pool.query('SELECT 1');
}

export function createKysely<DB>(pool: pg.Pool): Kysely<DB> {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

/**
 * Runs `fn` in one transaction on one connection. The current correlation id and trace context
 * are stored in the transaction-local settings `app.correlation_id` and `app.traceparent`; the
 * outbox columns default to them, so events written by SQL procedures carry them too.
 */
export async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const correlationId = currentCorrelationId() ?? '';
    const traceparent = injectTraceHeaders()['traceparent'] ?? '';
    if (correlationId !== '' || traceparent !== '') {
      await client.query(`SELECT set_config('app.correlation_id', $1, true), set_config('app.traceparent', $2, true)`, [
        correlationId,
        traceparent,
      ]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
