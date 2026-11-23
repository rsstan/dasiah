// Layout of a city (/cities/:code): the side panel (menu, the city, the current page) and the map.
// The map state belongs to one city, so it is created anew when the code changes.
import { useState } from 'react';
import { Link, Outlet, useParams } from 'react-router';
import { MapView } from '../features/map/MapView.tsx';
import { useAppData } from './AppData.tsx';
import { MapStateProvider, useMapState } from '../features/map/MapState.tsx';
import { Brand, SiteNav } from './SiteNav.tsx';
import { Button, ButtonLink } from '../shared/ui/index.ts';

export function CityLayout() {
  const { code } = useParams();
  const { cities, legend } = useAppData();
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
  return (
    <div className={mapOnly ? 'app map-only' : 'app'}>
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
          <h1>
            {city.name} <span className="country">{city.countryCode}</span>
          </h1>
        </div>
        <Outlet />
      </aside>
      <main className="map-area">
        <MapView
          bounds={city.bounds}
          results={calculation.kind === 'done' ? calculation.results : undefined}
          legend={legend}
          origin={origin}
          onPick={(point) => pick({ ...point, label: 'Point on the map' })}
        />
      </main>
    </div>
  );
}

function CityNotFound({ code }: { code: string }) {
  return (
    <div className="site">
      <header className="site-header">
        <Brand />
        <SiteNav />
      </header>
      <main className="site-main page">
        <section className="status-page" aria-labelledby="city-not-found">
          <p className="status-code">404</p>
          <h2 id="city-not-found">City not found</h2>
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
