import { describe, expect, it } from 'vitest';
import { search } from './geocoder-stub.ts';

describe('geocoder stub', () => {
  it('matches every word of the query, case-insensitively', () => {
    expect(search('central station', 5).map((a) => a.name)).toEqual(['Central Station']);
    expect(search('DOCK 12', 5).map((a) => a.street)).toEqual(['Dock Lane']);
    expect(search('testville', 3)).toHaveLength(3);
    expect(search('nowhere', 5)).toEqual([]);
  });
});
