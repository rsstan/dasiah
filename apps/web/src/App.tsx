// The page: map with its controls, and for a signed-in user the saved places, history and
// account. A map is computed when the user picks a start point (search, map click, saved place)
// or changes the departure; history opens an earlier map by its id. City, start point and
// departure are kept in the URL so a map can be shared and reloaded.
import { cellToLatLng } from 'h3-js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AccountView } from './account/AccountView.tsx';
import { AuthForm } from './account/AuthForm.tsx';
import { HistoryList, type HistoryEntry } from './account/HistoryList.tsx';
import { PlacesList } from './account/PlacesList.tsx';
import { SavePlaceForm } from './account/SavePlaceForm.tsx';
import type { City, LegendClass } from './api/types.ts';
import { useGet } from './api/useApi.ts';
import { useCalculation } from './calculation/useCalculation.ts';
import { AddressSearch } from './components/AddressSearch.tsx';
import { CitySwitch } from './components/CitySwitch.tsx';
import { Legend } from './components/Legend.tsx';
import { Status } from './components/Status.tsx';
import { MapView } from './map/MapView.tsx';
import { session } from './session/session.ts';
import { usePlaces, type SavedPlace } from './session/usePlaces.ts';
import { useSession } from './session/useSession.ts';
import { readUrlState, writeUrlState, type Origin } from './urlState.ts';

export function App() {
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
  return <MapPage cities={cities.data.items} legend={legend.data.items} />;
}

type Tab = 'map' | 'places' | 'history' | 'account' | 'sign-in';

interface Departure {
  date: string;
  time: string;
}

function MapPage({ cities, legend }: { cities: City[]; legend: LegendClass[] }) {
  const initial = useMemo(() => readUrlState(window.location.search), []);
  const [cityCode, setCityCode] = useState(
    cities.some((c) => c.code === initial.city) ? (initial.city as string) : (cities[0] as City).code,
  );
  const [origin, setOrigin] = useState<Origin | undefined>(initial.origin);
  const [departure, setDeparture] = useState<Departure>({ date: initial.date ?? '', time: initial.time ?? '08:00' });
  const [tab, setTab] = useState<Tab>('map');
  const { state, run, reset } = useCalculation();
  const auth = useSession();
  const signedIn = auth.kind === 'signed-in';
  const places = usePlaces(signedIn);
  const city = cities.find((c) => c.code === cityCode) as City;

  const compute = useCallback(
    (code: string, point: Origin | undefined, dep: Departure, open?: string) => {
      const target = cities.find((c) => c.code === code);
      if (point === undefined || target?.activeFeed == null) {
        return;
      }
      void run(
        {
          cityCode: code,
          origin: { lat: point.lat, lon: point.lon },
          windowMinutes: 0,
          ...(dep.date === '' ? {} : { date: dep.date }),
          ...(dep.time === '' ? {} : { time: dep.time }),
        },
        open,
      ).then((outcome) => {
        if (open !== undefined && outcome !== undefined) {
          setDeparture({ date: outcome.calculation.date, time: outcome.calculation.time });
        }
      });
    },
    [cities, run],
  );

  // A shared link: compute its map on mount. (In development StrictMode mounts twice; the first
  // request is cancelled by the unmount and the second one replaces it.)
  useEffect(() => {
    if (initial.origin !== undefined) {
      compute(cityCode, initial.origin, departure);
    }
    // Only on the first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    writeUrlState({ city: cityCode, origin, date: departure.date, time: departure.time });
  }, [cityCode, origin, departure]);

  // Signed out (sign-out, account deleted, session expired): back to the map.
  const [wasSignedIn, setWasSignedIn] = useState(signedIn);
  if (wasSignedIn !== signedIn) {
    setWasSignedIn(signedIn);
    if (!signedIn && tab !== 'map' && tab !== 'sign-in') {
      setTab('map');
    }
  }

  const pick = (code: string, point: Origin) => {
    if (code !== cityCode) {
      setCityCode(code);
    }
    setOrigin(point);
    setTab('map');
    compute(code, point, departure);
  };

  const switchCity = (code: string) => {
    if (code === cityCode) {
      return;
    }
    reset();
    setOrigin(undefined);
    setDeparture((d) => ({ ...d, date: '' }));
    setCityCode(code);
  };

  const changeDeparture = (dep: Departure) => {
    setDeparture(dep);
    compute(cityCode, origin, dep);
  };

  const pickOnMap = useCallback(
    (point: { lat: number; lon: number }) => {
      const o = { ...point, label: 'Point on the map' };
      setOrigin(o);
      setTab('map');
      compute(cityCode, o, departure);
    },
    [compute, cityCode, departure],
  );

  const showPlace = (p: SavedPlace) =>
    pick(p.cityCode, { lat: p.location.lat, lon: p.location.lon, label: p.label, address: p.addressText });

  const openHistory = (h: HistoryEntry) => {
    const [lat, lon] = cellToLatLng(h.originH3);
    const point = { lat, lon, label: 'Start point from history' };
    if (h.cityCode !== cityCode) {
      setCityCode(h.cityCode);
    }
    setOrigin(point);
    setTab('map');
    compute(h.cityCode, point, { date: '', time: '08:00' }, h.calculationId);
  };

  const feed = city.activeFeed;
  const cityPlaces = places.items.filter((p) => p.cityCode === cityCode);

  return (
    <div className="app">
      <aside className="panel">
        <header className="panel-header">
          <div>
            <h1>Transit Heatmap</h1>
            <p className="tagline">How much slower is public transport than a car?</p>
          </div>
          {auth.kind === 'signed-out' && tab !== 'sign-in' && (
            <button type="button" className="sign-in" onClick={() => setTab('sign-in')}>
              Sign in
            </button>
          )}
        </header>

        {signedIn && (
          <nav className="tabs" aria-label="Sections">
            {(
              [
                ['map', 'Map'],
                ['places', 'Places'],
                ['history', 'History'],
                ['account', auth.user.displayName ?? 'Account'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-current={tab === id ? 'page' : undefined}
                className={tab === id ? 'active' : ''}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
        )}

        {tab === 'sign-in' && (
          <>
            <AuthForm onDone={() => setTab('map')} />
            <button type="button" className="link" onClick={() => setTab('map')}>
              ← Back to the map
            </button>
          </>
        )}

        {tab === 'places' && <PlacesList places={places} cities={cities} onShow={showPlace} />}
        {tab === 'history' && <HistoryList cities={cities} onOpen={openHistory} />}
        {tab === 'account' && signedIn && <AccountView user={auth.user} />}

        {tab === 'map' && (
          <>
            <CitySwitch cities={cities} value={cityCode} onChange={switchCity} />
            <AddressSearch
              cityCode={cityCode}
              selected={origin?.label}
              onSelect={(c) => pick(cityCode, { lat: c.lat, lon: c.lon, label: c.displayName, address: c.displayName })}
            />
            {cityPlaces.length > 0 && (
              <div className="quick-picks" aria-label="Saved places">
                {cityPlaces.map((p) => (
                  <button key={p.placeId} type="button" onClick={() => showPlace(p)}>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            {signedIn && origin !== undefined && <SavePlaceForm origin={origin} cityCode={cityCode} places={places} />}
            {feed === null ? (
              <p className="status error">There is no timetable for {city.name} yet.</p>
            ) : (
              <fieldset className="departure">
                <legend>Departure</legend>
                <label>
                  Date
                  <input
                    type="date"
                    value={departure.date}
                    min={feed.validFrom}
                    max={feed.validTo}
                    onChange={(e) => changeDeparture({ ...departure, date: e.target.value })}
                  />
                </label>
                <label>
                  Time
                  <input
                    type="time"
                    value={departure.time}
                    step={300}
                    onChange={(e) => changeDeparture({ ...departure, time: e.target.value })}
                  />
                </label>
                <p className="hint">
                  Empty date: the next working day. Timetable valid {feed.validFrom} – {feed.validTo}.
                </p>
              </fieldset>
            )}
            <Status state={state} onRetry={() => compute(cityCode, origin, departure)} />
            <Legend classes={legend} />
          </>
        )}
      </aside>
      <main className="map-area">
        <MapView
          bounds={city.bounds}
          results={state.kind === 'done' ? state.results : undefined}
          legend={legend}
          origin={origin}
          onPick={pickOnMap}
        />
      </main>
    </div>
  );
}
