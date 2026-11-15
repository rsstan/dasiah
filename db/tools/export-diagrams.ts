// Renders the database diagrams to SVG and PNG for the thesis text (docs/db/img/):
//   - logical schema: the Mermaid block in docs/03-database.md#logical-schema
//   - one ER diagram per schema: the Mermaid blocks in docs/db/data-dictionary.md
//
//   pnpm db:diagrams
//
// Uses the local mermaid-cli (devDependency) with an installed Chrome or Chromium
// (CHROME_PATH, or the first one found), so nothing is sent to an online renderer.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = join(ROOT, 'docs/db/img');
/** mermaid-cli from devDependencies; pnpm does not run its postinstall, so no Chromium is downloaded. */
const MMDC = join(ROOT, 'node_modules/.bin/mmdc');

/** Colours of the logical schema (docs/03-database.md): fill, stroke. */
const SCHEMA_COLOURS: Record<string, readonly [string, string]> = {
  identity: ['#dbeafe', '#1d4ed8'],
  transit: ['#dcfce7', '#15803d'],
  accessibility: ['#ffedd5', '#c2410c'],
  places: ['#f3e8ff', '#7e22ce'],
};

function mermaidBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1] ?? '');
}

function findChrome(): string {
  const candidates = [
    process.env['CHROME_PATH'],
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const found = candidates.find((p): p is string => p !== undefined && p !== '' && existsSync(p));
  if (found === undefined) {
    throw new Error('No Chrome or Chromium found; set CHROME_PATH');
  }
  return found;
}

function render(work: string, name: string, source: string, colours?: readonly [string, string]): void {
  const input = join(work, `${name}.mmd`);
  const config = join(work, `${name}.json`);
  writeFileSync(input, source);
  const themeVariables =
    colours === undefined
      ? {}
      : {
          primaryColor: colours[0],
          mainBkg: colours[0],
          primaryBorderColor: colours[1],
          nodeBorder: colours[1],
          lineColor: colours[1],
          attributeBackgroundColorOdd: '#ffffff',
          attributeBackgroundColorEven: '#f8fafc',
        };
  writeFileSync(config, JSON.stringify({ theme: 'base', themeVariables, er: { layoutDirection: 'LR' } }));
  for (const ext of ['svg', 'png']) {
    execFileSync(
      MMDC,
      [
        '--quiet',
        '-i',
        input,
        '-o',
        join(OUT, `${name}.${ext}`),
        '-c',
        config,
        '-p',
        join(work, 'puppeteer.json'),
        '-b',
        'white',
        ...(ext === 'png' ? ['-s', '2'] : []),
      ],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
  }
  console.log(`docs/db/img/${name}.svg, .png`);
}

function main(): void {
  mkdirSync(OUT, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'diagrams-'));
  try {
    writeFileSync(join(work, 'puppeteer.json'), JSON.stringify({ executablePath: findChrome() }));

    const logical = mermaidBlocks(readFileSync(join(ROOT, 'docs/03-database.md'), 'utf8'))[0];
    if (logical === undefined) {
      throw new Error('No Mermaid block in docs/03-database.md');
    }
    render(work, 'logical-schema', logical);

    const dictionary = readFileSync(join(ROOT, 'docs/db/data-dictionary.md'), 'utf8');
    for (const section of dictionary.split(/^## Schema `/m).slice(1)) {
      const schema = section.slice(0, section.indexOf('`'));
      const block = mermaidBlocks(section)[0];
      if (block !== undefined && block.trim() !== 'erDiagram') {
        render(work, `er-${schema}`, block, SCHEMA_COLOURS[schema]);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
