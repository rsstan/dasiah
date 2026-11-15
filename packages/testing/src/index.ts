// Integration-test helpers. The database is set up exactly like a real one: PostGIS image,
// db/bootstrap (roles, schemas, default privileges) run by the superuser, role passwords, the
// service migrations as app_admin and the reference data. Services under test then connect
// as their own svc_* role, so privilege mistakes fail the tests.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { topology } from '@heatmap/contracts';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RabbitMQContainer, type StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import amqp from 'amqplib';
import pg from 'pg';
import { migrate } from '../../../db/tools/migrations.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
export const POSTGIS_IMAGE = 'postgis/postgis:16-3.7';
export const RABBITMQ_IMAGE = 'rabbitmq:4.3.7-management-alpine';

/** Only for throw-away test containers. */
const TEST_PASSWORD = 'test-only-password';
const DATABASE = 'heatmap';

export type DatabaseRole =
  'app_admin' | 'svc_identity' | 'svc_transit' | 'svc_accessibility' | 'svc_places' | 'reporting';

/** The last lines a container wrote, for error messages. */
async function containerLog(container: StartedPostgreSqlContainer, maxChars = 4_000): Promise<string> {
  try {
    const stream = await container.logs();
    let text = '';
    await new Promise<void>((resolve) => {
      stream.on('data', (chunk: Buffer | string) => {
        text = (text + chunk.toString()).slice(-maxChars);
      });
      stream.on('end', () => resolve());
      stream.on('error', () => resolve());
      setTimeout(resolve, 1_000);
    });
    return text;
  } catch (error) {
    return `(no log: ${error instanceof Error ? error.message : String(error)})`;
  }
}

export interface TestDatabase {
  readonly container: StartedPostgreSqlContainer;
  /** Connection URL for a role, e.g. `url('svc_identity')`. */
  url(role: DatabaseRole | 'superuser'): string;
  /** A pool as the superuser, for test set-up and assertions only. */
  readonly admin: pg.Pool;
  stop(): Promise<void>;
}

export interface StartDatabaseOptions {
  /** Services whose migrations are applied, e.g. `['identity']`. */
  readonly services: readonly string[];
  /** Reference data files of db/seed/reference to load, e.g. `['identity']`. */
  readonly referenceData?: readonly string[];
}

export async function startDatabase({ services, referenceData = [] }: StartDatabaseOptions): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(POSTGIS_IMAGE)
    .withDatabase(DATABASE)
    .withUsername('postgres')
    .withPassword(TEST_PASSWORD)
    .withCopyFilesToContainer([
      { source: resolve(ROOT, 'db/bootstrap/001_roles_schemas.sql'), target: '/bootstrap/001_roles_schemas.sql' },
    ])
    .withStartupTimeout(120_000)
    .start();
  const bootstrap = await container
    .exec([
      'psql',
      '-q',
      '-U',
      'postgres',
      '-d',
      DATABASE,
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      '/bootstrap/001_roles_schemas.sql',
    ])
    .catch(async (error: unknown) => {
      throw new Error(`bootstrap could not run; container log:\n${await containerLog(container)}`, { cause: error });
    });
  if (bootstrap.exitCode !== 0) {
    throw new Error(`bootstrap failed: ${bootstrap.output}`);
  }

  const url = (role: DatabaseRole | 'superuser'): string => {
    const u = new URL(container.getConnectionUri());
    u.username = role === 'superuser' ? 'postgres' : role;
    u.password = TEST_PASSWORD;
    return u.toString();
  };
  const admin = new pg.Pool({ connectionString: url('superuser'), max: 2 });
  for (const role of ['app_admin', 'svc_identity', 'svc_transit', 'svc_accessibility', 'svc_places', 'reporting']) {
    await admin.query(`ALTER ROLE ${role} PASSWORD '${TEST_PASSWORD}'`);
  }

  const owner = { connectionString: url('app_admin') };
  await migrate({ connection: owner, direction: 'up', count: Infinity, services });
  if (referenceData.length > 0) {
    const client = new pg.Client(owner);
    await client.connect();
    try {
      for (const name of referenceData) {
        await client.query(readFileSync(resolve(ROOT, 'db/seed/reference', `${name}.sql`), 'utf8'));
      }
    } finally {
      await client.end();
    }
  }

  return {
    container,
    url,
    admin,
    async stop() {
      await admin.end();
      await container.stop();
    },
  };
}

export interface TestBroker {
  readonly container: StartedRabbitMQContainer;
  readonly url: string;
  /**
   * Binds a fresh exclusive queue to heatmap.events for `routingKey` and returns a function that
   * waits for the next message on it (parsed body and AMQP properties).
   */
  listen(routingKey: string): Promise<() => Promise<{ body: unknown; properties: amqp.MessageProperties }>>;
  stop(): Promise<void>;
}

export async function startBroker(): Promise<TestBroker> {
  const container = await new RabbitMQContainer(RABBITMQ_IMAGE).withStartupTimeout(120_000).start();
  const url = container.getAmqpUrl();
  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();
  await channel.assertExchange(topology.exchange.name, topology.exchange.type, { durable: true });
  return {
    container,
    url,
    async listen(routingKey) {
      const { queue } = await channel.assertQueue('', { exclusive: true, durable: false });
      await channel.bindQueue(queue, topology.exchange.name, routingKey);
      const received: amqp.ConsumeMessage[] = [];
      await channel.consume(queue, (msg) => msg && received.push(msg), { noAck: true });
      return async (timeoutMs = 15_000) => {
        const deadline = Date.now() + timeoutMs;
        while (received.length === 0) {
          if (Date.now() > deadline) {
            throw new Error(`no ${routingKey} message within ${timeoutMs} ms`);
          }
          await new Promise((r) => setTimeout(r, 25));
        }
        const msg = received.shift() as amqp.ConsumeMessage;
        return { body: JSON.parse(msg.content.toString('utf8')) as unknown, properties: msg.properties };
      };
    },
    async stop() {
      await connection.close();
      await container.stop();
    },
  };
}

/** Polls until `condition` holds. */
export async function eventually(
  what: string,
  condition: () => Promise<boolean> | boolean,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}
