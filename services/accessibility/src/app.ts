// Assembles accessibility: database (as svc_accessibility), broker with the outbox publisher and
// the consumer of transit.feed.activated.v1, timetables from transit-data, HTTP server.
// Used by main.ts and by the integration tests (app.inject()).
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
import { CalculationService } from './calculation/calculations.ts';
import { OsrmClient } from './car/osrm.ts';
import type { Config } from './config.ts';
import type { AppContext } from './context.ts';
import { registerRoutes } from './http/routes.ts';
import type { AccessibilityDb } from './repositories/schema.ts';
import { TimetableLoader } from './timetables/loader.ts';
import { TimetableStore } from './timetables/store.ts';
import { TransitClient } from './timetables/transit-client.ts';

export const SERVICE = 'accessibility';
export const SCHEMA = 'accessibility';

export interface Service {
  readonly app: FastifyInstance;
  readonly ctx: AppContext;
  readonly loader: TimetableLoader;
  readonly calculations: CalculationService;
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

  const transit = new TransitClient(config.TRANSIT_URL, logger, config.TRANSIT_TIMEOUT_MS);
  const timetables = new TimetableStore(transit, logger, config.TIMETABLE_CACHE_SIZE);
  const loader = new TimetableLoader(timetables, transit, logger);

  const broker = new Broker({ url: config.AMQP_URL, service: SERVICE, logger });
  const outbox = new OutboxPublisher({
    pool,
    schema: SCHEMA,
    source: SERVICE,
    logger,
    // The event carries the id of a signed-in user: removed from the outbox once sent.
    deleteAfterPublish: ['accessibility.calculation.completed.v1'],
  });
  const consumer = new EventConsumer({
    pool,
    schema: SCHEMA,
    consumer: SERVICE,
    logger,
    handlers: loader.handlers(config.CITIES),
  });
  broker.attach(outbox);
  broker.attach(consumer);

  // Timetables first, then messages: an activation arriving now is applied after the start-up load.
  await loader.loadAll(config.CITIES, () => pool.connect());
  const stopRetry = loader.retryMissing(config.CITIES, () => pool.connect(), config.TIMETABLE_RETRY_MS);
  await broker.start();
  outbox.start();

  const ctx: AppContext = { config, logger, pool, db: createKysely<AccessibilityDb>(pool), outbox, timetables };

  const osrmUrls: Record<string, string | undefined> = { waw: config.OSRM_URL_WAW, vno: config.OSRM_URL_VNO };
  const osrm = new Map<string, OsrmClient>();
  for (const city of config.CITIES) {
    const url = osrmUrls[city];
    if (url === undefined) {
      logger.warn({ city }, 'no OSRM configured: maps of this city cannot be computed');
      continue;
    }
    osrm.set(
      city,
      new OsrmClient(city, url, logger, {
        chunkSize: config.OSRM_CHUNK_SIZE,
        parallel: config.OSRM_PARALLEL,
        timeoutMs: config.OSRM_TIMEOUT_MS,
        factor: config.CAR_TIME_FACTOR,
        overheadS: config.CAR_OVERHEAD_S,
      }),
    );
  }
  const calculations = new CalculationService(ctx, osrm);
  const interrupted = await calculations.failInterrupted(0);
  if (interrupted > 0) {
    logger.warn({ calculations: interrupted }, 'calculations interrupted by a restart marked failed');
  }
  const purge = setInterval(() => {
    calculations
      .purgeExpired()
      .then((n) => n > 0 && logger.info({ removed: n }, 'expired calculations purged'))
      .catch((error: unknown) => logger.warn({ err: error }, 'purge of expired calculations failed'));
  }, config.PURGE_INTERVAL_MS);
  purge.unref();
  const app = createServer({
    logger,
    trustProxy: config.TRUST_PROXY,
    readiness: {
      database: () => pingDatabase(pool),
      broker: () => broker.check(),
      timetable: async () => {
        if (timetables.loadedCities().length === 0) {
          throw new Error('no timetable loaded');
        }
      },
    },
  });
  await registerRoutes(app, ctx, calculations);

  app.addHook('onClose', async () => {
    clearInterval(purge);
    stopRetry();
    await consumer.stop();
    await outbox.stop();
    await broker.close();
    await pool.end();
  });
  return { app, ctx, loader, calculations };
}
