import { describe, expect, it } from 'vitest';
import { ApiError } from '../../shared/api/client.ts';
import { labelConflict, validateLabel } from './validation.ts';

describe('place name rules', () => {
  it('place names and the duplicate-name conflict', () => {
    expect(validateLabel('', 'save')).toBeUndefined();
    expect(validateLabel('  ', 'rename')).toBe('A name is required.');
    expect(validateLabel('x'.repeat(61), 'save')).toBe('The name can be at most 60 characters.');
    expect(labelConflict(new ApiError(409, { type: '/problems/duplicate-label' }, 'c'))).toMatch(/already have/);
    expect(labelConflict(new ApiError(409, { type: '/problems/place-limit' }, 'c'))).toBeUndefined();
  });
});
