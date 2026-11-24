// Imports a GTFS feed outside the HTTP API (as svc_transit), e.g. a file provided by hand:
//
//   pnpm transit:import --source waw_ztm --file data/gtfs/warsaw.zip [--activate]
//   pnpm transit:import --source waw_ztm --download [--activate]
//
// Runs the same pipeline as POST /admin/feed-sources/{code}/import and waits for it; prints the
// final status, row counts and timings (the "feed validated" log line).
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createLogger, runWithContext } from '@heatmap/common';
import { createService } from '../app.ts';
import { loadServiceConfig } from '../config.ts';
import { activateFeedVersion, getFeedVersion } from '../usecases/feeds.ts';

/** Returns the exit code: 0 imported (or already there), 2 the feed was refused. */
export async function importCommand(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      source: { type: 'string' },
      file: { type: 'string' },
      download: { type: 'boolean', default: false },
      activate: { type: 'boolean', default: false },
    },
  });
  if (values.source === undefined || (values.file === undefined) === !values.download) {
    throw new Error('usage: pnpm transit:import --source <code> (--file <zip> | --download) [--activate]');
  }
  const config = loadServiceConfig(env);
  const logger = createLogger({ service: 'transit-import', level: config.LOG_LEVEL });
  const service = await createService(config, logger);
  try {
    return await runWithContext({ correlationId: `cli-import-${Date.now()}` }, async () => {
      const started =
        values.file === undefined
          ? await service.importer.importFromUrl(values.source ?? '')
          : await service.importer.importFromFile(
              values.source ?? '',
              resolve(env['INIT_CWD'] ?? process.cwd(), values.file),
            );
      await started.done;
      let version = await getFeedVersion(service.ctx, started.feedVersionId);
      if (values.activate && version.status === 'validated') {
        version = await activateFeedVersion(service.ctx, version.feedVersionId);
      }
      logger.info({ ...version, duplicate: started.duplicate }, 'import finished');
      return version.status === 'failed' ? 2 : 0;
    });
  } finally {
    await service.app.close();
  }
}

if (process.argv[1] === import.meta.filename) {
  try {
    process.exitCode = await importCommand(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
