// Layout of every route: the panel on the left (header, navigation, the current page) and the map
// on the right, which stays mounted while the user moves between pages. Loads the cities and the
// legend once and restores the session from the refresh cookie.
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useMatch, useNavigate } from 'react-router';
import type { City, LegendClass } from '../api/types.ts';
import { useGet } from '../api/useApi.ts';
import { MapView } from '../map/MapView.tsx';
import { session } from '../session/session.ts';
import { useSession } from '../session/useSession.ts';
import { MapStateProvider, useMapState } from './MapState.tsx';

export function AppShell() {
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
  if (cities.data.items.length === 0) {
    return <div className="splash">No city is configured yet.</div>;
  }
  return (
    <MapStateProvider cities={cities.data.items} legend={legend.data.items}>
      <Layout />
    </MapStateProvider>
  );
}

function Layout() {
  const auth = useSession();
  const navigate = useNavigate();
  const onAdmin = useMatch('/admin') !== null;
  const onSignIn = useMatch('/sign-in') !== null;
  const onMap = useMatch({ path: '/', end: true }) !== null;
  /** Phones only: the panel folded down to its header and status, the map takes the screen. */
  const [mapOnly, setMapOnly] = useState(false);
  const { city, legend, origin, calculation, pick } = useMapState();

  return (
    <div className={['app', onAdmin ? 'wide' : '', mapOnly ? 'map-only' : ''].filter(Boolean).join(' ')}>
      <aside className="panel">
        <header className="panel-header">
          <div>
            <h1>
              <Link to="/" className="home-link">
                Transit Heatmap
              </Link>
            </h1>
            <p className="tagline">How much slower is public transport than a car?</p>
          </div>
          <div className="header-actions">
            {auth.kind === 'signed-out' && !onSignIn && !mapOnly && (
              <Link to="/sign-in" className="sign-in">
                Sign in
              </Link>
            )}
            <button
              type="button"
              className="sheet-toggle"
              aria-expanded={!mapOnly}
              onClick={() => {
                setMapOnly(!mapOnly);
                if (!mapOnly) {
                  void navigate('/');
                }
              }}
            >
              {mapOnly ? 'Controls' : 'Full map'}
            </button>
          </div>
        </header>

        {auth.kind === 'signed-in' && (
          <nav className="tabs" aria-label="Sections">
            <NavLink to="/" end>
              Map
            </NavLink>
            <NavLink to="/places">Places</NavLink>
            <NavLink to="/history">History</NavLink>
            {auth.user.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
            <NavLink to="/account">{auth.user.displayName ?? 'Account'}</NavLink>
          </nav>
        )}

        <Outlet />
      </aside>
      <main className="map-area">
        <MapView
          bounds={city.bounds}
          results={calculation.kind === 'done' ? calculation.results : undefined}
          legend={legend}
          origin={origin}
          onPick={(point) => {
            pick(city.code, { ...point, label: 'Point on the map' });
            if (!onMap) {
              void navigate('/');
            }
          }}
        />
      </main>
    </div>
  );
}
