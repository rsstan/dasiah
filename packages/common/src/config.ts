// Configuration from environment variables only, validated once at start-up. Every problem is
// reported at once and the process stops (fail fast). Values are never echoed in the error, so
// a misconfigured secret does not end up in a log.
import { z } from 'zod';
import { ConfigError } from './errors.ts';

export const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Variables every service and the gateway read. */
export const baseConfigSchema = z.object({
  SERVICE_NAME: z.string().regex(/^[a-z][a-z0-9-]*$/, 'lower-case name, e.g. identity'),
  PORT: z.coerce.number().int().min(1).max(65_535),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(logLevels).default('info'),
  /** Grace period for in-flight requests and handlers on SIGTERM. */
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
});

/** Connection settings of services that own a schema. */
export const databaseConfigSchema = z.object({
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'postgres://user:password@host:port/db'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).default(5_000),
});

export type BaseConfig = z.infer<typeof baseConfigSchema>;
export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;

/**
 * Parses `env` with `schema`. Throws ConfigError listing every missing or invalid variable.
 * Empty strings count as missing, so `.env.example`-style blanks are caught.
 */
export function loadConfig<S extends z.ZodType>(
  schema: S,
  env: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => {
        const name = issue.path.join('.') || '(root)';
        return issue.code === 'invalid_type' && issue.input === undefined
          ? `${name}: missing`
          : `${name}: ${issue.message}`;
      }),
    );
  }
  return result.data;
}
