// Runs node-pg-migrate for every service (or one) as app_admin.
//
//   node db/tools/migrate.ts [up|down|redo] [--count N|--all] [--service <name>]
//
// Each service keeps its own history table in its own schema (<schema>.pgmigrations),
// so services can be migrated and rolled back independently. Connection settings come
// from the libpq variables exported by scripts/with-env.sh; the password of app_admin
// from DB_PASSWORD_APP_ADMIN.
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runner } from 'node-pg-migrate';

interface ServiceMigrations {
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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      count: { type: 'string' },
      all: { type: 'boolean', default: false },
      service: { type: 'string' },
    },
  });
  const action = positionals[0] ?? 'up';
  if (action !== 'up' && action !== 'down' && action !== 'redo') {
    throw new Error(`Unknown action "${action}" (expected up, down or redo)`);
  }
  const selected = values.service === undefined ? SERVICES : SERVICES.filter((s) => s.service === values.service);
  if (selected.length === 0) {
    throw new Error(`Unknown service "${values.service ?? ''}"`);
  }
  // up: all pending by default. down: one step by default, --all for everything.
  const count = values.all
    ? Infinity
    : values.count !== undefined
      ? Number.parseInt(values.count, 10)
      : action === 'up'
        ? Infinity
        : 1;

  const databaseUrl = {
    host: process.env['PGHOST'] ?? 'localhost',
    port: Number.parseInt(process.env['PGPORT'] ?? '5432', 10),
    database: process.env['PGDATABASE'] ?? 'heatmap',
    user: 'app_admin',
    password: requireEnv('DB_PASSWORD_APP_ADMIN'),
  };

  // Roll back in reverse order so the output reads as the mirror image of "up".
  const ordered = action === 'up' ? selected : [...selected].reverse();
  for (const { service, schema } of ordered) {
    const run = async (direction: 'up' | 'down', n: number): Promise<void> => {
      const applied = await runner({
        databaseUrl,
        dir: resolve(import.meta.dirname, '../../services', service, 'migrations'),
        direction,
        count: n,
        migrationsTable: 'pgmigrations',
        migrationsSchema: schema,
        // Service schema first, then public for extension types and functions (PostGIS, citext).
        schema: [schema, 'public'],
        checkOrder: true,
        singleTransaction: true,
        verbose: false,
        log: () => undefined,
      });
      const names = applied.map((m) => m.name).join(', ') || 'nothing to do';
      console.log(`${service}: ${direction} -> ${names}`);
    };
    if (action === 'redo') {
      await run('down', count);
      await run('up', count);
    } else {
      await run(action, count);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
