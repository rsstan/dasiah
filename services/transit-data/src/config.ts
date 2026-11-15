// Environment of the transit-data service, validated at start-up (the process stops on any problem).
import { baseConfigSchema, databaseConfigSchema, loadConfig, messagingConfigSchema, z } from '@heatmap/common';

export const configSchema = baseConfigSchema
  .extend(databaseConfigSchema.shape)
  .extend(messagingConfigSchema.shape)
  .extend({
    /** Raw archives and timetable artifacts. `s3` comes with the cloud deployment. */
    STORAGE_DRIVER: z.enum(['fs']).default('fs'),
    STORAGE_PATH: z.string().default('./data/storage'),
    DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(300_000),
    MAX_DOWNLOAD_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .default(500 * 1_048_576),
    /** Promotion of a city-size feed runs far longer than an API statement. */
    IMPORT_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(1_800_000),
    /** Share of stops outside the city bounds above which an import fails (wrong feed for the city). */
    MAX_STOPS_OUTSIDE_SHARE: z.coerce.number().min(0).max(1).default(0.25),
    TRUST_PROXY: z.stringbool().default(true),
  });

export type Config = z.infer<typeof configSchema>;

export function loadServiceConfig(env: Record<string, string | undefined> = process.env): Config {
  return loadConfig(configSchema, env);
}
