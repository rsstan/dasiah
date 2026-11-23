import { describe, expect, it } from 'vitest';
import { readUrlState, toSearch } from './urlState.ts';

describe('URL state', () => {
  it('round-trips city, rounded start point and departure, without the address text', () => {
    const search = toSearch({
      city: 'vno',
      origin: { lat: 54.687123, lon: 25.279456, label: 'Gedimino prospektas 9' },
      date: '2026-12-02',
      time: '08:00',
    });
    expect(search).toBe('?city=vno&lat=54.6871&lon=25.2795&date=2026-12-02&time=08%3A00');
    expect(readUrlState(search)).toEqual({
      city: 'vno',
      origin: { lat: 54.6871, lon: 25.2795, label: 'Shared start point' },
      date: '2026-12-02',
      time: '08:00',
    });
  });

  it('ignores invalid values', () => {
    expect(readUrlState('?lat=500&lon=x&date=tomorrow&time=25:00')).toEqual({
      city: undefined,
      origin: undefined,
      date: undefined,
      time: undefined,
    });
    expect(toSearch({})).toBe('');
  });
});
