// Coverage per workspace as a Markdown table, from coverage/coverage-summary.json (pnpm test:cov).
// Printed to the terminal; CI appends it to the summary page of the run.
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const METRICS = ['lines', 'branches', 'functions'] as const;
type Metric = (typeof METRICS)[number];
type Counts = Record<Metric, { total: number; covered: number }>;
/** The file Istanbul's json-summary reporter writes: one entry per file plus "total". */
export type CoverageSummary = Record<string, Counts>;

const WEB = 'apps/web';

function add(into: Counts, from: Counts): void {
  for (const m of METRICS) {
    into[m].total += from[m].total;
    into[m].covered += from[m].covered;
  }
}

const empty = (): Counts => ({
  lines: { total: 0, covered: 0 },
  branches: { total: 0, covered: 0 },
  functions: { total: 0, covered: 0 },
});

/** "87.6 %"; a group without anything to cover is fully covered. */
export function percent({ total, covered }: { total: number; covered: number }): string {
  return `${(total === 0 ? 100 : (100 * covered) / total).toFixed(1)} %`;
}

export function coverageTable(summary: CoverageSummary, root: string): string {
  const groups = new Map<string, Counts>();
  const backEnd = empty();
  const all = empty();
  for (const [file, counts] of Object.entries(summary)) {
    if (file === 'total') {
      continue;
    }
    const workspace = relative(root, file).split(sep).slice(0, 2).join('/');
    const group = groups.get(workspace) ?? empty();
    add(group, counts);
    groups.set(workspace, group);
    add(all, counts);
    if (workspace !== WEB) {
      add(backEnd, counts);
    }
  }
  const row = (name: string, c: Counts) => `| ${name} | ${METRICS.map((m) => percent(c[m])).join(' | ')} |`;
  return [
    '| Workspace | Lines | Branches | Functions |',
    '| --- | --- | --- | --- |',
    ...[...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, c]) => row(name, c)),
    row('**Back end (gated)**', backEnd),
    row('Everything', all),
  ].join('\n');
}

if (process.argv[1] === import.meta.filename) {
  const root = resolve(import.meta.dirname, '..');
  const file = resolve(root, 'coverage/coverage-summary.json');
  console.log(coverageTable(JSON.parse(readFileSync(file, 'utf8')) as CoverageSummary, root));
}
