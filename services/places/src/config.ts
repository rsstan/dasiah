// Environment of the places service, validated at start-up (the process stops on any problem).
import { baseConfigSchema, databaseConfigSchema, loadConfig, messagingConfigSchema, z } from '@heatmap/common';

const httpUrl = z.url({ protocol: /^https?$/ });

export const configSchema = baseConfigSchema
  .extend(databaseConfigSchema.shape)
  .extend(messagingConfigSchema.shape)
  .extend({
    /** City list and bounding boxes come from transit-data (GET /cities). */
    TRANSIT_URL: httpUrl,
    GEOCODER_PROVIDER: z.enum(['photon', 'nominatim']).default('photon'),
    GEOCODER_URL: httpUrl.default('https://photon.komoot.io'),
    /** Minimum gap between two calls to the geocoder (public instances ask for at most 1 per second). */
    GEOCODER_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(1_000),
    GEOCODER_TIMEOUT_MS: z.coerce.number().int().min(100).default(5_000),
    /** How long a geocoder answer is reused. */
    GEOCODE_CACHE_TTL_S: z.coerce
      .number()
      .int()
      .min(60)
      .default(30 * 86_400),
    TRUST_PROXY: z.stringbool().default(true),
  });

export type Config = z.infer<typeof configSchema>;

export function loadServiceConfig(env: Record<string, string | undefined> = process.env): Config {
  return loadConfig(configSchema, env);
}
