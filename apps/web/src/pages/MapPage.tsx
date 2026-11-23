// "/": the controls of the map (city, start address, saved places, departure, status, legend).
// The city, start point and departure are mirrored into the query string, so the address bar
// always holds a link to the current map.
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { SavePlaceForm } from '../account/SavePlaceForm.tsx';
import { useMapState } from '../app/MapState.tsx';
import { AddressSearch } from '../components/AddressSearch.tsx';
import { CitySwitch } from '../components/CitySwitch.tsx';
import { Legend } from '../components/Legend.tsx';
import { Status } from '../components/Status.tsx';
import { usePlaces, type SavedPlace } from '../session/usePlaces.ts';
import { useSession } from '../session/useSession.ts';
import { toSearch } from '../urlState.ts';

export function MapPage() {
  const { cities, legend, city, origin, departure, calculation, pick, switchCity, changeDeparture, retry } =
    useMapState();
  const auth = useSession();
  const signedIn = auth.kind === 'signed-in';
  const places = usePlaces(signedIn);
  const [searchParams, setSearchParams] = useSearchParams();

  const search = toSearch({ city: city.code, origin, date: departure.date, time: departure.time });
  useEffect(() => {
    if (`?${searchParams.toString()}` !== search && !(search === '' && searchParams.size === 0)) {
      setSearchParams(new URLSearchParams(search), { replace: true });
    }
  }, [search, searchParams, setSearchParams]);

  const showPlace = (p: SavedPlace) =>
    pick(p.cityCode, { lat: p.location.lat, lon: p.location.lon, label: p.label, address: p.addressText });
  const feed = city.activeFeed;
  const cityPlaces = places.items.filter((p) => p.cityCode === city.code);

  return (
    <>
      <CitySwitch cities={cities} value={city.code} onChange={switchCity} />
      <AddressSearch
        cityCode={city.code}
        selected={origin?.label}
        onSelect={(c) => pick(city.code, { lat: c.lat, lon: c.lon, label: c.displayName, address: c.displayName })}
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
      {signedIn && origin !== undefined && <SavePlaceForm origin={origin} cityCode={city.code} places={places} />}
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
      <Status state={calculation} onRetry={retry} />
      <Legend classes={legend} />
    </>
  );
}
