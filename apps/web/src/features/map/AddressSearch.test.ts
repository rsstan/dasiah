import { describe, expect, it } from 'vitest';
import { uniqueByName } from './AddressSearch.tsx';

describe('uniqueByName', () => {
  it('keeps the first candidate of each name', () => {
    const a = { displayName: 'Gedimino pr. 9, Vilnius', lat: 54.68, lon: 25.28 };
    const b = { displayName: 'Gedimino pr. 9, Vilnius', lat: 54.69, lon: 25.29 };
    const c = { displayName: 'G9, Gedimino pr. 9, Vilnius', lat: 54.68, lon: 25.28 };
    expect(uniqueByName([a, b, c])).toEqual([a, c]);
  });
});
