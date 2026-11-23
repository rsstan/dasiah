// "/cities/:code": the controls of the map (start address, the user's saved places in this
// city, departure, status, legend). The start point and departure are mirrored into the query
// string, so the address bar always holds a link to the current map.
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { SavePlaceForm } from '../features/places/SavePlaceForm.tsx';
import { useMapState } from '../features/map/MapState.tsx';
import { AddressSearch } from '../features/map/AddressSearch.tsx';
import { Legend } from '../features/map/Legend.tsx';
import { Status } from '../features/map/Status.tsx';
import { usePlaces, type SavedPlace } from '../features/places/api.ts';
import { useSession } from '../features/auth/useSession.ts';
import { toSearch } from '../features/map/urlState.ts';
import { Button, TextField } from '../shared/ui/index.ts';

export function MapPage() {
  const { city, legend, origin, departure, calculation, pick, changeDeparture, retry } = useMapState();
  const auth = useSession();
  const signedIn = auth.kind === 'signed-in';
  const places = usePlaces(signedIn);
  const [searchParams, setSearchParams] = useSearchParams();

  const search = toSearch({ origin, date: departure.date, time: departure.time });
  useEffect(() => {
    const current = searchParams.toString();
    if ((current === '' ? '' : `?${current}`) !== search) {
      setSearchParams(new URLSearchParams(search), { replace: true });
    }
  }, [search, searchParams, setSearchParams]);

  const showPlace = (p: SavedPlace) =>
    pick({ lat: p.location.lat, lon: p.location.lon, label: p.label, address: p.addressText });
  const feed = city.activeFeed;
  const cityPlaces = places.items.filter((p) => p.cityCode === city.code);

  return (
    <>
      <AddressSearch
        cityCode={city.code}
        selected={origin?.label}
        onSelect={(c) => pick({ lat: c.lat, lon: c.lon, label: c.displayName, address: c.displayName })}
      />
      {cityPlaces.length > 0 && (
        <div className="quick-picks" aria-label="Saved places">
          {cityPlaces.map((p) => (
            <Button key={p.placeId} size="sm" onClick={() => showPlace(p)}>
              {p.label}
            </Button>
          ))}
        </div>
      )}
      {signedIn && origin !== undefined && <SavePlaceForm origin={origin} cityCode={city.code} places={places} />}
      {feed === null ? (
        <p className="status error">There is no timetable for {city.name} yet.</p>
      ) : (
        <fieldset className="departure">
          <legend>Departure</legend>
          <TextField
            label="Date"
            type="date"
            value={departure.date}
            min={feed.validFrom}
            max={feed.validTo}
            onChange={(e) => changeDeparture({ ...departure, date: e.target.value })}
          />
          <TextField
            label="Time"
            type="time"
            value={departure.time}
            step={300}
            onChange={(e) => changeDeparture({ ...departure, time: e.target.value })}
          />
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
