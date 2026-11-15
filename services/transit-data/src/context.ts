// Everything handlers and use cases need; created once in app.ts.
import type { Kysely, Logger, OutboxPublisher, Pool } from '@heatmap/common';
import type { Config } from './config.ts';
import type { TransitDb } from './repositories/schema.ts';
import type { Storage } from './storage.ts';

export interface AppContext {
  readonly config: Config;
  readonly logger: Logger;
  readonly pool: Pool;
  readonly db: Kysely<TransitDb>;
  readonly outbox: OutboxPublisher;
  readonly storage: Storage;
}
