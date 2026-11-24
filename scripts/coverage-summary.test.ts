import { describe, expect, it } from 'vitest';
import { coverageTable, percent, type CoverageSummary } from './coverage-summary.ts';

const counts = (covered: number, total: number): CoverageSummary[string] => ({
  lines: { covered, total },
  branches: { covered, total },
  functions: { covered, total },
});

describe('coverage table', () => {
  it('weights files by size and keeps the web client out of the back-end row', () => {
    const table = coverageTable(
      {
        total: counts(1, 1),
        '/repo/services/places/src/a.ts': counts(90, 90),
        '/repo/services/places/src/b.ts': counts(0, 10),
        '/repo/apps/gateway/src/app.ts': counts(50, 100),
        '/repo/apps/web/src/main.tsx': counts(0, 200),
      },
      '/repo',
    );
    const cells = (name: string) => table.split('\n').find((l) => l.startsWith(`| ${name}`));
    expect(cells('services/places')).toContain('90.0 %');
    expect(cells('**Back end')).toContain('70.0 %');
    expect(cells('Everything')).toContain('35.0 %');
  });

  it('counts a group without code as covered', () => {
    expect(percent({ total: 0, covered: 0 })).toBe('100.0 %');
    expect(percent({ total: 3, covered: 2 })).toBe('66.7 %');
  });
});
