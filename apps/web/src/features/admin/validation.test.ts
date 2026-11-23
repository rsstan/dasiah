import { describe, expect, it } from 'vitest';
import { validateSourceCode } from './validation.ts';

describe('feed import rules', () => {
  it('feed source codes', () => {
    expect(validateSourceCode('')).toBe('A feed source is required.');
    expect(validateSourceCode('Vno-VVT')).toMatch(/lowercase/);
    expect(validateSourceCode('vno_vvt')).toBeUndefined();
  });
});
