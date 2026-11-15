// __NAME__ service entry point. Started with `node --import @heatmap/common/otel src/main.ts` so
// tracing is set up before anything else is imported.
//
// Layout: http/ (routes, request/response mapping) -> usecases/ (business rules, transactions)
// -> repositories/ (SQL on schema __SCHEMA__ only); consumers/ (event handlers).
import {
  assertServiceRole,
  Broker,
  createKysely,
  createLogger,
  createPool,
  createServer,
  EventConsumer,
  OutboxPublisher,
  pingDatabase,
  runServer,
} from '@heatmap/common';
import { loadServiceConfig } from './config.ts';
import type { AppContext } from './context.ts';
import { registerRoutes } from './http/routes.ts';

const SERVICE = '__NAME__';
const SCHEMA = '__SCHEMA__';

async function main(): Promise<void> {
  const config = loadServiceConfig();
  const logger = createLogger({ service: config.SERVICE_NAME, level: config.LOG_LEVEL });

  const pool = createPool({
    connectionString: config.DATABASE_URL,
    applicationName: config.SERVICE_NAME,
    max: config.DB_POOL_MAX,
    statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
  });
  const role = await assertServiceRole(pool);
  logger.info({ role }, 'database role checked');

  const broker = new Broker({ url: config.AMQP_URL, service: SERVICE, logger });
  const outbox = new OutboxPublisher({ pool, schema: SCHEMA, source: SERVICE, logger });
  broker.attach(outbox);
  // Consumers: one EventConsumer with a handler per consumed event type (see consumers/).
  const consumer = new EventConsumer({ pool, schema: SCHEMA, consumer: SERVICE, logger, handlers: {} });
  if (consumer.queues().length > 0) {
    broker.attach(consumer);
  }
  await broker.start();
  outbox.start();

  const ctx: AppContext = { config, logger, pool, db: createKysely<unknown>(pool), outbox };
  const app = createServer({
    logger,
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
  await runServer(app, { host: config.HOST, port: config.PORT, shutdownTimeoutMs: config.SHUTDOWN_TIMEOUT_MS });
}

main().catch((error: unknown) => {
  // The logger may not exist yet (bad configuration); print and stop.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
