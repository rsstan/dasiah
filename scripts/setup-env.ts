// Prepares .env for a local trial with Docker only (compose.setup.yaml runs it in a Node
// container, so the host needs neither Node nor openssl):
//   docker compose -f compose.setup.yaml run --rm setup
// Adds every variable the local stack needs and that .env does not have yet, with random
// passwords and a fresh Ed25519 token-signing key; existing values are never changed. Prints the
// next command and where to look once the stack is up.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { chownSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const FILE = resolve(ROOT, '.env');

const secret = () => randomBytes(16).toString('hex');

/** Variables of the local trial in file order; functions are evaluated only when missing. */
const WANTED: [string, string | (() => string), string?][] = [
  [
    'COMPOSE_PROFILES',
    'full',
    'Local trial (compose.yaml): every service in containers, stand-ins for OSRM and the geocoder',
  ],
  ['POSTGRES_DB', 'heatmap'],
  ['POSTGRES_USER', 'postgres'],
  ['POSTGRES_PASSWORD', secret],
  ['DB_PASSWORD_APP_ADMIN', secret],
  ['DB_PASSWORD_SVC_IDENTITY', secret],
  ['DB_PASSWORD_SVC_TRANSIT', secret],
  ['DB_PASSWORD_SVC_ACCESSIBILITY', secret],
  ['DB_PASSWORD_SVC_PLACES', secret],
  ['DB_PASSWORD_REPORTING', secret],
  ['RABBITMQ_USER', 'heatmap'],
  ['RABBITMQ_PASSWORD', secret],
  ['SEED_DEMO_PASSWORD', secret, 'Password of the demo accounts demo.user@example.com and demo.admin@example.com'],
  [
    'JWT_PRIVATE_KEY',
    () =>
      generateKeyPairSync('ed25519')
        .privateKey.export({ type: 'pkcs8', format: 'pem' })
        .toString()
        .trim()
        .replaceAll('\n', '\\n'),
    'Ed25519 key that signs access tokens (PKCS#8 PEM, one line)',
  ],
  ['JWT_KEY_ID', 'local-1'],
  ['WEB_PORT', '8000', 'Host ports of the local trial'],
  ['JAEGER_UI_PORT', '16686'],
  ['RABBITMQ_UI_PORT', '15672'],
];

function parse(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match?.[1] !== undefined) {
      values.set(match[1], match[2] ?? '');
    }
  }
  return values;
}

if (process.argv.length > 2) {
  console.error(
    [
      `setup takes no arguments (got: ${process.argv.slice(2).join(' ')}).`,
      'It only adds the variables .env lacks and never changes a value. To change one, edit .env,',
      'e.g. WEB_PORT=8080, then run: docker compose up -d --wait',
    ].join('\n'),
  );
  process.exit(2);
}

const existed = existsSync(FILE);
const before = existed ? readFileSync(FILE, 'utf8') : '';
const current = parse(before);
const added: string[] = [];
const lines: string[] = [];
for (const [name, value, comment] of WANTED) {
  if ((current.get(name) ?? '') !== '') {
    continue;
  }
  if (comment !== undefined) {
    lines.push(`# ${comment}`);
  }
  lines.push(`${name}=${typeof value === 'function' ? value() : value}`);
  added.push(name);
}

if (added.length > 0) {
  const header = existed
    ? `\n# ---- Added by scripts/setup-env.ts (${new Date().toISOString().slice(0, 10)})\n`
    : '# Created by scripts/setup-env.ts for the local trial. Not in Git; keep it private.\n';
  const separator = before === '' || before.endsWith('\n') ? '' : '\n';
  writeFileSync(FILE, `${before}${separator}${header}${lines.join('\n')}\n`, { mode: 0o600 });
  // Running in a container as root: give the file to the owner of the checkout (Linux hosts).
  const owner = statSync(ROOT);
  try {
    chownSync(FILE, owner.uid, owner.gid);
  } catch {
    // Not permitted (rootless or Windows/macOS file sharing): the file is still usable.
  }
}

const env = parse(readFileSync(FILE, 'utf8'));
const port = (name: string, fallback: string) => env.get(name) || fallback;
const web = `http://localhost:${port('WEB_PORT', '8000')}`;

console.log(
  [
    existed
      ? added.length > 0
        ? `.env existed; added ${added.length} missing variable(s): ${added.join(', ')}`
        : '.env already complete; nothing changed'
      : `.env created with ${added.length} variables (random passwords, new token-signing key)`,
    '',
    'Next: build and start everything (first time 5-10 minutes), waiting until all is healthy:',
    '',
    '  docker compose up -d --build --wait',
    '',
    'Then:',
    `  Map (choose Warsaw, search "Central Station")  ${web}`,
    `  Health of the gateway and every service       ${web}/health`,
    `  Traces (Jaeger)                               http://localhost:${port('JAEGER_UI_PORT', '16686')}`,
    `  Message broker (RabbitMQ)                     http://localhost:${port('RABBITMQ_UI_PORT', '15672')}   user ${env.get('RABBITMQ_USER') ?? 'heatmap'}, password RABBITMQ_PASSWORD in .env`,
    `  Demo accounts                                 demo.user@example.com, demo.admin@example.com   password SEED_DEMO_PASSWORD in .env`,
    '  Database (read-only role, masked data)        docker compose exec postgres psql -U reporting -d heatmap',
    '  Containers and their state                    docker compose ps',
    '  Logs of one service                           docker compose logs -f accessibility',
    '  Stop / remove with data                       docker compose down   /   docker compose down -v',
  ].join('\n'),
);
