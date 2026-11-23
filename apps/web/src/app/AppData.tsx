// Root of every route: waits for the cities of this instance and the legend (TanStack Query,
// cached), restores the session from the refresh cookie, and offers the loaded data to the pages
// (useAppData), so a page never deals with "cities not loaded yet".
import { createContext, use, useEffect } from 'react';
import { Outlet } from 'react-router';
import type { City, LegendClass } from '../models/types.ts';
import { describeError } from '../shared/api/client.ts';
import { session } from '../features/auth/session.ts';
import { useCitiesQuery, useLegendQuery } from '../features/cities/api.ts';
import { Button, Skeleton } from '../shared/ui/index.ts';

export interface AppData {
  cities: readonly City[];
  legend: readonly LegendClass[];
}

const AppDataContext = createContext<AppData | undefined>(undefined);

export function useAppData(): AppData {
  const data = use(AppDataContext);
  if (data === undefined) {
    throw new Error('useAppData outside RootLayout');
  }
  return data;
}

export function RootLayout() {
  const cities = useCitiesQuery();
  const legend = useLegendQuery();

  useEffect(() => {
    void session.restore();
  }, []);

  if (cities.isPending || legend.isPending) {
    return (
      <div className="splash">
        <Skeleton lines={4} variant="card" />
      </div>
    );
  }
  if (cities.isError || legend.isError) {
    return (
      <div className="splash error" role="alert">
        <p>{describeError(cities.error ?? legend.error)}</p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
  return (
    <AppDataContext value={{ cities: cities.data, legend: legend.data }}>
      <Outlet />
    </AppDataContext>
  );
}
