// "/places": the user's saved places; "show" opens one on the map.
import { useNavigate } from 'react-router';
import { PlacesList } from '../account/PlacesList.tsx';
import { useMapState } from '../app/MapState.tsx';
import { usePlaces } from '../session/usePlaces.ts';

export function PlacesPage() {
  const { cities, pick } = useMapState();
  const places = usePlaces(true);
  const navigate = useNavigate();
  return (
    <PlacesList
      places={places}
      cities={cities}
      onShow={(p) => {
        pick(p.cityCode, { lat: p.location.lat, lon: p.location.lon, label: p.label, address: p.addressText });
        void navigate('/');
      }}
    />
  );
}
