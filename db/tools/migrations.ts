// Runs the SQL migrations of one or more services with node-pg-migrate, as app_admin.
// Each service keeps its own history table in its own schema (<schema>.pgmigrations), so
// services can be migrated and rolled back independently. Used by the CLI (migrate.ts) and by
// the integration-test helpers (@heatmap/testing).
import { resolve } from 'node:path';
import { runner } from 'node-pg-migrate';
import type { ClientConfig } from 'pg';

export interface ServiceMigrations {
  readonly service: string;
  /** Schema that holds the pgmigrations table; first entry of the search path. */
  readonly schema: string;
}

/** Order matters only for readability: there are no cross-schema dependencies. */
export const SERVICES: readonly ServiceMigrations[] = [
  { service: 'identity', schema: 'identity' },
  { service: 'transit-data', schema: 'transit' },
  { service: 'accessibility', schema: 'accessibility' },
  { service: 'places', schema: 'places' },
];

export interface MigrateOptions {
  /** Connection as app_admin. */
  readonly connection: ClientConfig;
  readonly direction: 'up' | 'down';
  /** Number of migrations per service; Infinity for all. */
  readonly count: number;
  /** Services to migrate; default all. */
  readonly services?: readonly string[];
  readonly onApplied?: (service: string, direction: 'up' | 'down', names: readonly string[]) => void;
}

export async function migrate({ connection, direction, count, services, onApplied }: MigrateOptions): Promise<void> {
  const selected = services === undefined ? SERVICES : SERVICES.filter((s) => services.includes(s.service));
  if (services !== undefined && selected.length !== services.length) {
    throw new Error(`Unknown service in ${services.join(', ')}`);
  }
  const ordered = direction === 'up' ? selected : [...selected].reverse();
  for (const { service, schema } of ordered) {
    const applied = await runner({
      databaseUrl: connection,
      dir: resolve(import.meta.dirname, '../../services', service, 'migrations'),
      direction,
      count,
      migrationsTable: 'pgmigrations',
      migrationsSchema: schema,
      // Service schema first, then public for extension types and functions (PostGIS, citext).
      schema: [schema, 'public'],
      checkOrder: true,
      singleTransaction: true,
      verbose: false,
      log: () => undefined,
    });
    onApplied?.(
      service,
      direction,
      applied.map((m) => m.name),
    );
  }
}
