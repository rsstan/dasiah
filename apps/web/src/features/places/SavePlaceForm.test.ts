import { describe, expect, it } from 'vitest';
import { addressOf } from './SavePlaceForm.tsx';

describe('addressOf', () => {
  it('uses the geocoded address, else the coordinates', () => {
    expect(addressOf({ lat: 54.687, lon: 25.28, label: 'x', address: 'Gedimino pr. 9, Vilnius' })).toBe(
      'Gedimino pr. 9, Vilnius',
    );
    expect(addressOf({ lat: 54.687123456, lon: 25.28, label: 'Point on the map' })).toBe('54.68712, 25.28000');
  });
});
