import { describe, expect, it } from 'vitest';
import { loadServiceConfig } from './config.ts';

describe('__NAME__ configuration', () => {
  it('stops on missing variables', () => {
    expect(() => loadServiceConfig({})).toThrow(/DATABASE_URL: missing/);
  });
});
