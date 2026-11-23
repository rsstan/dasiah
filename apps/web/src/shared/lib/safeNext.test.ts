import { describe, expect, it } from 'vitest';
import { safeNext } from './safeNext.ts';

describe('safeNext', () => {
  it('returns only paths inside the application', () => {
    expect(safeNext('/places?x=1')).toBe('/places?x=1');
    expect(safeNext(null)).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('//evil.example/path')).toBe('/');
  });
});
