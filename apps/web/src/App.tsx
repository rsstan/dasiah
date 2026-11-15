// Map page: city switch, address search (or a click on the map), departure date and time,
// the heatmap with legend and status. City, start point and departure are kept in the URL so a
// map can be shared and reloaded.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { City, Coordinates, LegendClass } from './api/types.ts';
import { useGet } from './api/useApi.ts';
import { useCalculation } from './calculation/useCalculation.ts';
import { AddressSearch } from './components/AddressSearch.tsx';
import { CitySwitch } from './components/CitySwitch.tsx';
import { Legend } from './components/Legend.tsx';
import { Status } from './components/Status.tsx';
import { MapView } from './map/MapView.tsx';
import { readUrlState, writeUrlState, type Origin } from './urlState.ts';

export function App() {
  const cities = useGet<{ items: City[] }>('/cities');
  const legend = useGet<{ items: LegendClass[] }>('/legend');

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

function MapPage({ cities, legend }: { cities: City[]; legend: LegendClass[] }) {
  const initial = useMemo(() => readUrlState(window.location.search), []);
  const [cityCode, setCityCode] = useState(
    cities.some((c) => c.code === initial.city) ? (initial.city as string) : (cities[0] as City).code,
  );
  const [origin, setOrigin] = useState<Origin | undefined>(initial.origin);
  const [date, setDate] = useState(initial.date ?? '');
  const [time, setTime] = useState(initial.time ?? '08:00');
  const { state, run, reset } = useCalculation();
  const city = cities.find((c) => c.code === cityCode) as City;
  const feed = city.activeFeed;

  const calculate = useCallback(() => {
    if (origin === undefined || feed === null) {
      return;
    }
    void run({
      cityCode,
      origin: { lat: origin.lat, lon: origin.lon },
      windowMinutes: 0,
      ...(date === '' ? {} : { date }),
      ...(time === '' ? {} : { time }),
    });
  }, [run, cityCode, origin, date, time, feed]);

  useEffect(() => {
    calculate();
  }, [calculate]);

  useEffect(() => {
    writeUrlState({ city: cityCode, origin, date, time });
  }, [cityCode, origin, date, time]);

  const switchCity = (code: string) => {
    if (code === cityCode) {
      return;
    }
    reset();
    setOrigin(undefined);
    setDate('');
    setCityCode(code);
  };

  const pickOnMap = useCallback((point: Coordinates) => {
    setOrigin({ ...point, label: 'Point on the map' });
  }, []);

  return (
    <div className="app">
      <aside className="panel">
        <header>
          <h1>Transit Heatmap</h1>
          <p className="tagline">How much slower is public transport than a car?</p>
        </header>
        <CitySwitch cities={cities} value={cityCode} onChange={switchCity} />
        <AddressSearch
          cityCode={cityCode}
          selected={origin?.label}
          onSelect={(c) => setOrigin({ lat: c.lat, lon: c.lon, label: c.displayName })}
        />
        {feed === null ? (
          <p className="status error">There is no timetable for {city.name} yet.</p>
        ) : (
          <fieldset className="departure">
            <legend>Departure</legend>
            <label>
              Date
              <input
                type="date"
                value={date}
                min={feed.validFrom}
                max={feed.validTo}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              Time
              <input type="time" value={time} step={300} onChange={(e) => setTime(e.target.value)} />
            </label>
            <p className="hint">
              Empty date: the next working day. Timetable valid {feed.validFrom} – {feed.validTo}.
            </p>
          </fieldset>
        )}
        <Status state={state} onRetry={calculate} />
        <Legend classes={legend} />
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
