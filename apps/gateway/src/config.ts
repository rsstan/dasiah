// Environment of the gateway, validated at start-up (the process stops on any problem).
import { baseConfigSchema, loadConfig, z } from '@heatmap/common';

const httpUrl = z.url({ protocol: /^https?$/ });

export const configSchema = baseConfigSchema.extend({
  IDENTITY_URL: httpUrl,
  TRANSIT_URL: httpUrl,
  ACCESSIBILITY_URL: httpUrl,
  PLACES_URL: httpUrl,
  REDIS_URL: z.string().regex(/^rediss?:\/\//, 'redis://host:6379'),
  /** Allowed browser origins (comma-separated), e.g. http://localhost:5173 */
  WEB_ORIGIN: z
    .string()
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o !== ''),
    )
    .pipe(z.array(z.url()).min(1)),
  JWT_ISSUER: z.string().default('heatmap-identity'),
  JWT_AUDIENCE: z.string().default('heatmap'),
  /** Per-attempt timeout towards identity, transit-data and places. */
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(100).default(10_000),
  /** accessibility computes maps synchronously, so it gets longer. */
  ACCESSIBILITY_TIMEOUT_MS: z.coerce.number().int().min(100).default(60_000),
  BREAKER_THRESHOLD: z.coerce.number().int().min(1).default(5),
  BREAKER_HALF_OPEN_MS: z.coerce.number().int().min(100).default(10_000),
  RATE_LIMIT_WINDOW_S: z.coerce.number().int().min(1).default(60),
  BODY_LIMIT_BYTES: z.coerce.number().int().min(1_024).default(1_048_576),
  /** true only behind a reverse proxy (Caddy) that sets X-Forwarded-For. */
  TRUST_PROXY: z.stringbool().default(false),
});

export type Config = z.infer<typeof configSchema>;

export function loadGatewayConfig(env: Record<string, string | undefined> = process.env): Config {
  return loadConfig(configSchema, env);
}
