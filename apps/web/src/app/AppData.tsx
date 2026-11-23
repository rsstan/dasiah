// Root of every route: loads the cities of this instance and the legend once, restores the
// session from the refresh cookie, and offers both to the pages (useAppData).
import { createContext, use, useEffect } from 'react';
import { Outlet } from 'react-router';
import type { City, LegendClass } from '../api/types.ts';
import { useGet } from '../api/useApi.ts';
import { session } from '../session/session.ts';

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
  const cities = useGet<{ items: City[] }>('/cities');
  const legend = useGet<{ items: LegendClass[] }>('/legend');

  useEffect(() => {
    void session.restore();
  }, []);

  if (cities.kind === 'loading' || legend.kind === 'loading') {
    return <div className="splash">Loading…</div>;
  }
  if (cities.kind === 'error' || legend.kind === 'error') {
    return (
      <div className="splash error" role="alert">
        <p>{cities.kind === 'error' ? cities.message : legend.kind === 'error' ? legend.message : ''}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
  return (
    <AppDataContext value={{ cities: cities.data.items, legend: legend.data.items }}>
      <Outlet />
    </AppDataContext>
  );
}
