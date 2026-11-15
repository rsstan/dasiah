// Creates services/<name> from templates/service.
//
//   pnpm new:service <name> --schema <schema> [--port 3000] [--description "..."]
//
// Afterwards: pnpm install, write contracts/openapi/<name>.yaml, add the Compose entry
// (infra/docker/service.Dockerfile with SERVICE=services/<name>), and go through
// .claude/skills/service-checklist/SKILL.md.
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = resolve(import.meta.dirname, '..');
const TEMPLATE = join(ROOT, 'templates/service');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

function main(): void {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { schema: { type: 'string' }, port: { type: 'string' }, description: { type: 'string' } },
  });
  const name = positionals[0];
  if (name === undefined || !/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error('usage: pnpm new:service <name> --schema <schema> [--description "..."]');
  }
  const schema = values.schema ?? name.replace(/-/g, '_');
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error(`invalid schema name ${schema}`);
  }
  const target = join(ROOT, 'services', name);
  if (existsSync(join(target, 'package.json'))) {
    throw new Error(`services/${name} is already a package`);
  }
  // A service may already have migrations or a few source files; existing files are kept.
  cpSync(TEMPLATE, target, { recursive: true, errorOnExist: false, force: false });
  const replacements: Record<string, string> = {
    __NAME__: name,
    __SCHEMA__: schema,
    __DESCRIPTION__: values.description ?? `${name} service`,
    __PORT__: values.port ?? '3000',
  };
  const created = new Set(files(TEMPLATE).map((f) => f.slice(TEMPLATE.length)));
  for (const file of files(target).filter((f) => created.has(f.slice(target.length)))) {
    const text = readFileSync(file, 'utf8');
    const replaced = Object.entries(replacements).reduce((acc, [token, value]) => acc.replaceAll(token, value), text);
    if (replaced !== text) {
      writeFileSync(file, replaced);
    }
  }
  console.log(`created services/${name} (schema ${schema}); next: pnpm install`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
