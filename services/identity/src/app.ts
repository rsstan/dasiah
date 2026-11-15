// Assembles the identity service: database (as svc_identity), broker with the outbox publisher,
// token issuer, HTTP server with routes. Used by main.ts and by the integration tests.
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
import { TokenIssuer } from './domain/tokens.ts';
import { registerRoutes } from './http/routes.ts';
import type { IdentityDb } from './repositories/schema.ts';

export const SERVICE = 'identity';
export const SCHEMA = 'identity';

export interface IdentityService {
  readonly app: FastifyInstance;
  readonly ctx: AppContext;
}

export async function createIdentityService(config: Config, logger: Logger): Promise<IdentityService> {
  const tokens = new TokenIssuer({
    privateKeyPem: config.JWT_PRIVATE_KEY,
    keyId: config.JWT_KEY_ID,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    accessTtlS: config.ACCESS_TTL_S,
  });

  const pool = createPool({
    connectionString: config.DATABASE_URL,
    applicationName: config.SERVICE_NAME,
    max: config.DB_POOL_MAX,
    statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
  });
  try {
    const role = await assertServiceRole(pool);
    logger.info({ role }, 'database role checked');
  } catch (error) {
    await pool.end();
    throw error;
  }

  const broker = new Broker({ url: config.AMQP_URL, service: SERVICE, logger });
  const outbox = new OutboxPublisher({ pool, schema: SCHEMA, source: SERVICE, logger });
  broker.attach(outbox);
  await broker.start();
  outbox.start();

  const ctx: AppContext = { config, logger, db: createKysely<IdentityDb>(pool), tokens, outbox };
  const app = createServer({
    logger,
    trustProxy: config.TRUST_PROXY,
    readiness: { database: () => pingDatabase(pool), broker: () => broker.check() },
  });
  await registerRoutes(app, ctx);

  // Shutdown: finish the outbox batch, then close the broker and the pool.
  app.addHook('onClose', async () => {
    await outbox.stop();
    await broker.close();
    await pool.end();
  });
  return { app, ctx };
}
