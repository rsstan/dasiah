// Everything handlers, use cases and consumers need; created once in app.ts.
import type { Kysely, Logger, OutboxPublisher, Pool } from '@heatmap/common';
import type { Config } from './config.ts';
import type { AccessibilityDb } from './repositories/schema.ts';
import type { TimetableStore } from './timetables/store.ts';

export interface AppContext {
  readonly config: Config;
  readonly logger: Logger;
  readonly pool: Pool;
  readonly db: Kysely<AccessibilityDb>;
  readonly outbox: OutboxPublisher;
  readonly timetables: TimetableStore;
}
