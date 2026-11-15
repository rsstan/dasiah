// Environment of the identity service, validated at start-up (the process stops on any problem).
import { baseConfigSchema, databaseConfigSchema, loadConfig, messagingConfigSchema, z } from '@heatmap/common';

export const configSchema = baseConfigSchema
  .extend(databaseConfigSchema.shape)
  .extend(messagingConfigSchema.shape)
  .extend({
    /** Ed25519 private key, PKCS#8 PEM. `\n` escapes are accepted so it fits on one .env line. */
    JWT_PRIVATE_KEY: z
      .string()
      .transform((v) => v.replace(/\\n/g, '\n'))
      .refine((v) => v.includes('BEGIN PRIVATE KEY'), 'PKCS#8 PEM expected'),
    JWT_KEY_ID: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
    JWT_ISSUER: z.string().default('heatmap-identity'),
    JWT_AUDIENCE: z.string().default('heatmap'),
    ACCESS_TTL_S: z.coerce.number().int().min(60).max(3_600).default(900),
    REFRESH_TTL_S: z.coerce.number().int().min(3_600).default(2_592_000),
    /** false only for plain-HTTP development outside localhost. */
    COOKIE_SECURE: z.stringbool().default(true),
    /** Failed sign-ins (since the last success) within the window that lock an account. */
    LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).default(5),
    LOGIN_LOCK_WINDOW_S: z.coerce.number().int().min(60).default(900),
    /** The service is reachable only through the gateway, which sets X-Forwarded-For. */
    TRUST_PROXY: z.stringbool().default(true),
  });

export type Config = z.infer<typeof configSchema>;

export function loadServiceConfig(env: Record<string, string | undefined> = process.env): Config {
  return loadConfig(configSchema, env);
}
