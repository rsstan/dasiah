// Environment of the __NAME__ service, validated at start-up (the process stops on any problem).
import { baseConfigSchema, databaseConfigSchema, loadConfig, messagingConfigSchema, type z } from '@heatmap/common';

export const configSchema = baseConfigSchema
  .extend(databaseConfigSchema.shape)
  .extend(messagingConfigSchema.shape)
  .extend({
    // Service-specific variables go here, e.g. SOME_TIMEOUT_MS: z.coerce.number().int().default(5000)
  });

export type Config = z.infer<typeof configSchema>;

export function loadServiceConfig(env: Record<string, string | undefined> = process.env): Config {
  return loadConfig(configSchema, env);
}
