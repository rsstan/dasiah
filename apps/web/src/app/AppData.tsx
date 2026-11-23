// Root of every route: waits for the cities of this instance and the legend (TanStack Query,
// cached), restores the session from the refresh cookie, and offers the loaded data to the pages
// (useCityData), so a page never deals with "cities not loaded yet".
import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { describeError } from '../shared/api/client.ts';
import { session } from '../features/auth/index.ts';
import { CityDataContext, useCitiesQuery, useLegendQuery } from '../features/cities/index.ts';
import { Button, Skeleton } from '../shared/ui/index.ts';

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
    <CityDataContext value={{ cities: cities.data, legend: legend.data }}>
      <Outlet />
    </CityDataContext>
  );
}
