// Cells of a map per legend class, in legend order (every class, also those without cells).
import type { CellResult, LegendClass } from '../../models/types.ts';

export interface ClassShare {
  cls: LegendClass;
  count: number;
  /** Share of all cells, 0..1. */
  share: number;
}

export function classShares(cells: readonly CellResult[], legend: readonly LegendClass[]): ClassShare[] {
  const counts = new Map<string, number>();
  for (const cell of cells) {
    counts.set(cell.class, (counts.get(cell.class) ?? 0) + 1);
  }
  const total = cells.length;
  return [...legend]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((cls) => {
      const count = counts.get(cls.code) ?? 0;
      return { cls, count, share: total === 0 ? 0 : count / total };
    });
}

/** "23 %", "<1 %" for a share above zero that rounds to nothing, "0 %". */
export function formatShare(share: number): string {
  if (share > 0 && share < 0.005) {
    return '<1 %';
  }
  return `${Math.round(share * 100)} %`;
}
