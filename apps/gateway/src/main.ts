// Gateway entry point. Started with `node --import @heatmap/common/otel src/main.ts` so tracing
// is set up before anything else is imported.
import { createLogger, runServer } from '@heatmap/common';
import { createGateway } from './app.ts';
import { loadGatewayConfig } from './config.ts';

try {
  const config = loadGatewayConfig();
  const logger = createLogger({ service: config.SERVICE_NAME, level: config.LOG_LEVEL });
  const { app } = await createGateway(config, logger).catch((error: unknown) => {
    logger.fatal({ err: error }, 'start-up failed');
    throw error;
  });
  await runServer(app, { host: config.HOST, port: config.PORT, shutdownTimeoutMs: config.SHUTDOWN_TIMEOUT_MS });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
