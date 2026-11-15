// Assembles transit-data: database (as svc_transit), broker with the outbox publisher (for
// transit.feed.activated.v1, written by transit.activate_feed), storage, importer, artifacts,
// HTTP server. Used by main.ts, the CLI and the integration tests.
import {
  assertServiceRole,
  Broker,
  createKysely,
  createPool,
  createServer,
  OutboxPublisher,
  pingDatabase,
  type FastifyInstance,
  type Logger,
} from '@heatmap/common';
import type { Config } from './config.ts';
import type { AppContext } from './context.ts';
import { registerRoutes } from './http/routes.ts';
import { Importer } from './import/importer.ts';
import type { TransitDb } from './repositories/schema.ts';
import { FsStorage } from './storage.ts';
import { ArtifactStore } from './timetable/artifacts.ts';

export const SERVICE = 'transit-data';
export const SCHEMA = 'transit';

export interface Service {
  readonly app: FastifyInstance;
  readonly ctx: AppContext;
  readonly importer: Importer;
  readonly artifacts: ArtifactStore;
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
  await broker.start();
  outbox.start();

  const ctx: AppContext = {
    config,
    logger,
    pool,
    db: createKysely<TransitDb>(pool),
    outbox,
    storage: new FsStorage(config.STORAGE_PATH),
  };
  const importer = new Importer(ctx);
  const interrupted = await importer.failInterrupted();
  if (interrupted > 0) {
    logger.warn({ feed_versions: interrupted }, 'imports interrupted by a restart marked failed');
  }
  const artifacts = new ArtifactStore(ctx);

  const app = createServer({
    logger,
    trustProxy: config.TRUST_PROXY,
    readiness: { database: () => pingDatabase(pool), broker: () => broker.check() },
  });
  await registerRoutes(app, ctx, { importer, artifacts });

  app.addHook('onClose', async () => {
    await outbox.stop();
    await broker.close();
    await pool.end();
  });
  return { app, ctx, importer, artifacts };
}
