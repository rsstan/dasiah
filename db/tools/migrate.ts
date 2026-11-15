// CLI for the service migrations, as app_admin.
//
//   node db/tools/migrate.ts [up|down|redo] [--count N|--all] [--service <name>]
//
// Connection settings come from the libpq variables exported by scripts/with-env.sh; the
// password of app_admin from DB_PASSWORD_APP_ADMIN.
import { parseArgs } from 'node:util';
import { migrate } from './migrations.ts';

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
  // up: all pending by default. down: one step by default, --all for everything.
  const count = values.all
    ? Infinity
    : values.count !== undefined
      ? Number.parseInt(values.count, 10)
      : action === 'up'
        ? Infinity
        : 1;
  const connection = {
    host: process.env['PGHOST'] ?? 'localhost',
    port: Number.parseInt(process.env['PGPORT'] ?? '5432', 10),
    database: process.env['PGDATABASE'] ?? 'heatmap',
    user: 'app_admin',
    password: requireEnv('DB_PASSWORD_APP_ADMIN'),
  };
  const services = values.service === undefined ? undefined : [values.service];
  const onApplied = (service: string, direction: string, names: readonly string[]) =>
    console.log(`${service}: ${direction} -> ${names.join(', ') || 'nothing to do'}`);
  const run = (direction: 'up' | 'down') => migrate({ connection, direction, count, services, onApplied });
  if (action === 'redo') {
    await run('down');
    await run('up');
  } else {
    await run(action);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
