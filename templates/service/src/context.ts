// Everything handlers, use cases and consumers need; created once in main.ts.
import type { Kysely, Logger, OutboxPublisher, Pool } from '@heatmap/common';
import type { Config } from './config.ts';

export interface AppContext {
  readonly config: Config;
  readonly logger: Logger;
  readonly pool: Pool;
  /** Replace `unknown` with the table types of schema __SCHEMA__. */
  readonly db: Kysely<unknown>;
  readonly outbox: OutboxPublisher;
}
