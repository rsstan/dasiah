// Environment of the accessibility service, validated at start-up (the process stops on any problem).
import { baseConfigSchema, databaseConfigSchema, loadConfig, messagingConfigSchema, z } from '@heatmap/common';

const httpUrl = z.url({ protocol: /^https?$/ });

export const configSchema = baseConfigSchema
  .extend(databaseConfigSchema.shape)
  .extend(messagingConfigSchema.shape)
  .extend({
    TRANSIT_URL: httpUrl,
    /** Cities whose timetables are loaded (comma-separated codes). */
    CITIES: z
      .string()
      .default('waw,vno')
      .transform((v) =>
        v
          .split(',')
          .map((c) => c.trim())
          .filter((c) => c !== ''),
      )
      .pipe(z.array(z.string().regex(/^[a-z]{3}$/)).min(1)),
    /** Timetables of single dates kept in memory (per city and feed version), least recently used out. */
    TIMETABLE_CACHE_SIZE: z.coerce.number().int().min(1).default(6),
    TRANSIT_TIMEOUT_MS: z.coerce.number().int().min(100).default(30_000),
    TRUST_PROXY: z.stringbool().default(true),
  });

export type Config = z.infer<typeof configSchema>;

export function loadServiceConfig(env: Record<string, string | undefined> = process.env): Config {
  return loadConfig(configSchema, env);
}
