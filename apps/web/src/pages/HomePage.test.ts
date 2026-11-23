import { describe, expect, it } from 'vitest';
import type { City } from '../models/types.ts';
import { filterCities, flag } from './HomePage.tsx';

const city = (code: string, name: string, countryCode: string): City => ({
  code,
  name,
  countryCode,
  timezone: 'Europe/Vilnius',
  h3Resolution: 9,
  bounds: { west: 0, south: 0, east: 1, north: 1 },
  activeFeed: null,
});
const CITIES = [city('waw', 'Warsaw', 'PL'), city('vno', 'Vilnius', 'LT'), city('krk', 'Kraków', 'PL')];

describe('home page', () => {
  it('sorts cities by name and filters by name, country or code', () => {
    expect(filterCities(CITIES, '').map((c) => c.code)).toEqual(['krk', 'vno', 'waw']);
    expect(filterCities(CITIES, 'pl').map((c) => c.code)).toEqual(['krk', 'waw']);
    expect(filterCities(CITIES, '  VIL ').map((c) => c.code)).toEqual(['vno']);
    expect(filterCities(CITIES, 'xyz')).toEqual([]);
  });

  it('turns a country code into its flag', () => {
    expect(flag('LT')).toBe('🇱🇹');
    expect(flag('pl')).toBe('');
  });
});
