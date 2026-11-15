// Everything handlers and use cases need; created once in app.ts.
import type { Kysely, Logger, OutboxPublisher } from '@heatmap/common';
import type { Config } from './config.ts';
import type { TokenIssuer } from './domain/tokens.ts';
import type { IdentityDb } from './repositories/schema.ts';

export interface AppContext {
  readonly config: Config;
  readonly logger: Logger;
  readonly db: Kysely<IdentityDb>;
  readonly tokens: TokenIssuer;
  readonly outbox: OutboxPublisher;
}

/** Where a request came from; stored with sessions and audit events. */
export interface ClientInfo {
  readonly userAgent: string | null;
  readonly ip: string | null;
}
