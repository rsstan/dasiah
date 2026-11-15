// Assembles places: database (as svc_places), consumers of
// accessibility.calculation.completed.v1 (history) and identity.user.deleted.v1 (erasure),
// geocoder, city directory, HTTP server. Used by main.ts and by the integration tests.
import {
  assertServiceRole,
  Broker,
  createPool,
  createServer,
  EventConsumer,
  pingDatabase,
  type FastifyInstance,
  type Logger,
} from '@heatmap/common';
import type { Config } from './config.ts';
import type { AppContext } from './context.ts';
import { CityDirectory } from './geocoding/cities.ts';
import { NominatimGeocoder, PhotonGeocoder, type Geocoder } from './geocoding/geocoder.ts';
import { registerRoutes } from './http/routes.ts';
import { eventHandlers } from './usecases/history.ts';

export const SERVICE = 'places';
export const SCHEMA = 'places';

export interface Service {
  readonly app: FastifyInstance;
  readonly ctx: AppContext;
}

export async function createService(config: Config, logger: Logger, geocoder?: Geocoder): Promise<Service> {
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

  const options = { minIntervalMs: config.GEOCODER_MIN_INTERVAL_MS, timeoutMs: config.GEOCODER_TIMEOUT_MS };
  const ctx: AppContext = {
    config,
    logger,
    pool,
    geocoder:
      geocoder ??
      (config.GEOCODER_PROVIDER === 'nominatim'
        ? new NominatimGeocoder(config.GEOCODER_URL, logger, options)
        : new PhotonGeocoder(config.GEOCODER_URL, logger, options)),
    cities: new CityDirectory(config.TRANSIT_URL, logger),
  };

  const broker = new Broker({ url: config.AMQP_URL, service: SERVICE, logger });
  const consumer = new EventConsumer({
    pool,
    schema: SCHEMA,
    consumer: SERVICE,
    logger,
    handlers: eventHandlers(logger),
  });
  broker.attach(consumer);
  await broker.start();

  const app = createServer({
    logger,
    trustProxy: config.TRUST_PROXY,
    readiness: { database: () => pingDatabase(pool), broker: () => broker.check() },
  });
  await registerRoutes(app, ctx);

  app.addHook('onClose', async () => {
    await consumer.stop();
    await broker.close();
    await pool.end();
  });
  return { app, ctx };
}
