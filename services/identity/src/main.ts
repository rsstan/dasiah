// identity service entry point. Started with `node --import @heatmap/common/otel src/main.ts` so
// tracing is set up before anything else is imported.
import { createLogger, runServer } from '@heatmap/common';
import { createIdentityService } from './app.ts';
import { loadServiceConfig } from './config.ts';

try {
  const config = loadServiceConfig();
  const logger = createLogger({ service: config.SERVICE_NAME, level: config.LOG_LEVEL });
  const { app } = await createIdentityService(config, logger).catch((error: unknown) => {
    logger.fatal({ err: error }, 'start-up failed');
    throw error;
  });
  await runServer(app, { host: config.HOST, port: config.PORT, shutdownTimeoutMs: config.SHUTDOWN_TIMEOUT_MS });
} catch (error) {
  // Before the logger exists (bad configuration) this is the only way to say why.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
