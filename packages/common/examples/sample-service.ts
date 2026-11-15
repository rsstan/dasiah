// Minimal service built from the platform code, used to demonstrate step 2.2:
// health checks, correlation id in logs, a trace with an HTTP server span, a PostgreSQL span
// and an outgoing HTTP call.
//
//   SERVICE_NAME=sample-service PORT=3999 DATABASE_URL=postgres://svc_identity:...@localhost:5432/heatmap \
//   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
//   node --import ./packages/common/src/otel-register.ts packages/common/examples/sample-service.ts
import {
  assertServiceRole,
  baseConfigSchema,
  createLogger,
  createPool,
  createServer,
  databaseConfigSchema,
  HttpClient,
  loadConfig,
  pingDatabase,
  runServer,
} from '../src/index.ts';

const config = loadConfig(baseConfigSchema.extend(databaseConfigSchema.shape));
const logger = createLogger({ service: config.SERVICE_NAME, level: config.LOG_LEVEL });

const pool = createPool({
  connectionString: config.DATABASE_URL,
  applicationName: config.SERVICE_NAME,
  max: config.DB_POOL_MAX,
  statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
});
const role = await assertServiceRole(pool).catch((error: unknown) => {
  logger.fatal({ err: error }, 'refusing to start');
  process.exit(1);
});
logger.info({ role }, 'database role checked');

// Calls itself, to show an outgoing call in the same trace with the correlation id forwarded.
const self = new HttpClient({ name: 'self', baseUrl: `http://127.0.0.1:${config.PORT}`, logger });

const app = createServer({ logger, readiness: { database: () => pingDatabase(pool) } });
app.addHook('onClose', async () => {
  await pool.end();
});

app.get('/echo', async (req) => ({ correlationId: req.id }));

app.get('/hello', async (req) => {
  const { rows } = await pool.query<{ role: string; now: string }>('SELECT current_user AS role, now()::text AS now');
  const echo = await self.getJson<{ correlationId: string }>('/echo');
  req.log.info({ role: rows[0]?.role }, 'said hello');
  return { hello: 'world', dbRole: rows[0]?.role, dbTime: rows[0]?.now, forwardedCorrelationId: echo.correlationId };
});

await runServer(app, { host: config.HOST, port: config.PORT, shutdownTimeoutMs: config.SHUTDOWN_TIMEOUT_MS });
