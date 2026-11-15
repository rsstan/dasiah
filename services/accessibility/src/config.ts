// Environment of the accessibility service, validated at start-up (the process stops on any problem).
import { availableParallelism } from 'node:os';
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
    /** OSRM per city; a city without one cannot compute maps. */
    OSRM_URL_WAW: httpUrl.optional(),
    OSRM_URL_VNO: httpUrl.optional(),
    OSRM_TIMEOUT_MS: z.coerce.number().int().min(100).default(10_000),
    OSRM_CHUNK_SIZE: z.coerce.number().int().min(1).max(1_000).default(500),
    OSRM_PARALLEL: z.coerce.number().int().min(1).default(4),
    /** Minimum gap between OSRM requests per city; 1000 for the public demo server. */
    OSRM_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(0),
    /** car_s = round(duration x factor) + overhead (docs/05-algorithms.md#7). */
    CAR_TIME_FACTOR: z.coerce.number().min(0.1).max(5).default(1),
    CAR_OVERHEAD_S: z.coerce.number().int().min(0).default(0),
    /** Bump when the method changes, so old cached maps are not reused (docs/05-algorithms.md#8). */
    ALGO_VERSION: z.coerce.number().int().min(1).default(1),
    /** Bulkhead: calculations at once (default: CPU cores) and waiting in the queue. */
    MAX_PARALLEL_CALCS: z.coerce.number().int().min(1).default(availableParallelism()),
    MAX_QUEUED_CALCS: z.coerce
      .number()
      .int()
      .min(0)
      .default(availableParallelism() * 2),
    PURGE_INTERVAL_MS: z.coerce.number().int().min(1_000).default(600_000),
    /** How often cities without a timetable are tried again. */
    TIMETABLE_RETRY_MS: z.coerce.number().int().min(100).default(30_000),
    TRUST_PROXY: z.stringbool().default(true),
  });

export type Config = z.infer<typeof configSchema>;

export function loadServiceConfig(env: Record<string, string | undefined> = process.env): Config {
  return loadConfig(configSchema, env);
}
