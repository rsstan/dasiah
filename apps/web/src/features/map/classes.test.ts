import { describe, expect, it } from 'vitest';
import type { CellResult } from '../../models/types.ts';
import { LEGEND } from '../../shared/test-support.ts';
import { classShares, formatShare } from './classes.ts';

const cell = (cls: CellResult['class']): CellResult => ({
  h3: 'x',
  transitS: null,
  carS: null,
  ratio: null,
  class: cls,
});

describe('class shares', () => {
  it('counts every legend class in legend order, also those without cells', () => {
    const cells = [cell('good'), cell('good'), cell('poor'), cell('unreachable')];
    const shares = classShares(cells, LEGEND);
    expect(shares.map((s) => s.cls.code)).toEqual(
      [...LEGEND].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => c.code),
    );
    expect(shares.find((s) => s.cls.code === 'good')).toMatchObject({ count: 2, share: 0.5 });
    expect(shares.find((s) => s.cls.code === 'excellent')).toMatchObject({ count: 0, share: 0 });
    expect(shares.reduce((sum, s) => sum + s.count, 0)).toBe(4);
    expect(classShares([], LEGEND).every((s) => s.share === 0)).toBe(true);
  });

  it('writes shares as whole percent, tiny ones as <1 %', () => {
    expect([0, 0.004, 0.005, 0.234, 1].map(formatShare)).toEqual(['0 %', '<1 %', '1 %', '23 %', '100 %']);
  });
});
