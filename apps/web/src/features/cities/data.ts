// The cities of this instance and the legend, loaded once by the root layout (app/AppData.tsx)
// and offered to every page, so a page never deals with "cities not loaded yet".
import { createContext, use } from 'react';
import type { City, LegendClass } from '../../models/types.ts';

export interface CityData {
  cities: readonly City[];
  legend: readonly LegendClass[];
}

/** Provided by the root layout; tests that render a page without it provide it themselves. */
export const CityDataContext = createContext<CityData | undefined>(undefined);

export function useCityData(): CityData {
  const data = use(CityDataContext);
  if (data === undefined) {
    throw new Error('useCityData outside the root layout');
  }
  return data;
}
