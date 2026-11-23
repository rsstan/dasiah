// Layout of a city (/cities/:code): the side panel (menu, the city, the current page) and the map.
// The map state belongs to one city, so it is created anew when the code changes.
import { Suspense, useCallback, useState } from 'react';
import { Link, Outlet, useParams } from 'react-router';
import { MapView, MapStateProvider, useMapState } from '../features/map/index.ts';
import { useCityData } from '../features/cities/index.ts';
import { Brand, SiteNav } from './SiteNav.tsx';
import { Button, ButtonLink, PageTitle } from '../shared/ui/index.ts';
import { SkipLink } from './SkipLink.tsx';

export function CityLayout() {
  const { code } = useParams();
  const { cities, legend } = useCityData();
  const city = cities.find((c) => c.code === code);
  if (city === undefined) {
    return <CityNotFound code={code ?? ''} />;
  }
  return (
    <MapStateProvider key={city.code} city={city} legend={legend}>
      <Workspace />
    </MapStateProvider>
  );
}

function Workspace() {
  const { city, legend, origin, calculation, pick } = useMapState();
  /** Phones only: the panel folded down to its header and status, the map takes the screen. */
  const [mapOnly, setMapOnly] = useState(false);
  // Stable, so the memoised map does not re-render when only the panel changes.
  const onPick = useCallback(
    (point: { lat: number; lon: number }) => pick({ ...point, label: 'Point on the map' }),
    [pick],
  );
  return (
    <div className={mapOnly ? 'app map-only' : 'app'}>
      <SkipLink target="content" />
      <aside className="panel">
        <header className="panel-header">
          <Brand />
          <Button size="sm" className="sheet-toggle" aria-expanded={!mapOnly} onClick={() => setMapOnly(!mapOnly)}>
            {mapOnly ? 'Controls' : 'Full map'}
          </Button>
        </header>
        <SiteNav />
        <div className="city-heading">
          <Link to="/" className="back-link">
            ← All cities
          </Link>
          <PageTitle title={city.name} visible id="content">
            {city.name} <span className="country">{city.countryCode}</span>
          </PageTitle>
        </div>
        <Outlet />
      </aside>
      <main className="map-area">
        {/* The map engine is a separate chunk; the panel works while it loads. */}
        <Suspense fallback={<MapLoading />}>
          <MapView
            bounds={city.bounds}
            results={calculation.kind === 'done' ? calculation.results : undefined}
            legend={legend}
            origin={origin}
            onPick={onPick}
          />
        </Suspense>
      </main>
    </div>
  );
}

function MapLoading() {
  return (
    <div className="map-wrap map-loading" role="status">
      Loading the map…
    </div>
  );
}

function CityNotFound({ code }: { code: string }) {
  return (
    <div className="site">
      <SkipLink target="content" />
      <header className="site-header">
        <Brand />
        <SiteNav />
      </header>
      <main id="content" tabIndex={-1} className="site-main page">
        <section className="status-page" aria-labelledby="city-not-found">
          <p className="status-code">404</p>
          <PageTitle title="City not found" visible id="city-not-found" />
          <p className="hint">
            This instance has no city with the code <code>{code}</code>.
          </p>
          <ButtonLink to="/" variant="primary">
            See all cities
          </ButtonLink>
        </section>
      </main>
    </div>
  );
}
