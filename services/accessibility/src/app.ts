// Assembles the accessibility service: database (as svc_*), broker with outbox publisher and consumer,
// HTTP server with routes. Used by main.ts and by the integration tests (app.inject()).
//
// Layout: http/ (routes, request/response mapping) -> usecases/ (business rules, transactions)
// -> repositories/ (SQL on schema accessibility only); consumers/ (event handlers).
import {
  assertServiceRole,
  Broker,
  createKysely,
  createPool,
  createServer,
  EventConsumer,
  OutboxPublisher,
  pingDatabase,
  type FastifyInstance,
  type Logger,
} from '@heatmap/common';
import type { Config } from './config.ts';
import type { AppContext } from './context.ts';
import { registerRoutes } from './http/routes.ts';

export const SERVICE = 'accessibility';
export const SCHEMA = 'accessibility';

export interface Service {
  readonly app: FastifyInstance;
  readonly ctx: AppContext;
}

export async function createService(config: Config, logger: Logger): Promise<Service> {
  const pool = createPool({
    connectionString: config.DATABASE_URL,
    applicationName: config.SERVICE_NAME,
    max: config.DB_POOL_MAX,
    statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
  });
  try {
    logger.info({ role: await assertServiceRole(pool) }, 'database role checked');
  } catch (error) {
    await pool.end();
    throw error;
  }

  const broker = new Broker({ url: config.AMQP_URL, service: SERVICE, logger });
  const outbox = new OutboxPublisher({ pool, schema: SCHEMA, source: SERVICE, logger });
  broker.attach(outbox);
  // One handler per consumed event type (see consumers/); queues come from the AsyncAPI contract.
  const consumer = new EventConsumer({ pool, schema: SCHEMA, consumer: SERVICE, logger, handlers: {} });
  if (consumer.queues().length > 0) {
    broker.attach(consumer);
  }
  await broker.start();
  outbox.start();

  const ctx: AppContext = { config, logger, pool, db: createKysely<unknown>(pool), outbox };
  const app = createServer({
    logger,
    trustProxy: true, // reachable only through the gateway on the internal network
    readiness: { database: () => pingDatabase(pool), broker: () => broker.check() },
  });
  await registerRoutes(app, ctx);

  // Shutdown order: stop taking messages, finish the outbox batch, close the broker and pool.
  app.addHook('onClose', async () => {
    await consumer.stop();
    await outbox.stop();
    await broker.close();
    await pool.end();
  });
  return { app, ctx };
}
