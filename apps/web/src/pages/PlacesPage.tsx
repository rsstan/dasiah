// "/places": the user's saved places in every city, filtered by city; "show" opens the city
// with the place as the start point.
import { useNavigate } from 'react-router';
import { PlacesList, usePlaces } from '../features/places/index.ts';
import { useCityData } from '../features/cities/index.ts';
import { type CityNavigationState, toSearch } from '../features/map/index.ts';

export function PlacesPage() {
  const { cities } = useCityData();
  const places = usePlaces(true);
  const navigate = useNavigate();
  return (
    <PlacesList
      places={places}
      cities={cities}
      onShow={(p) => {
        const origin = { lat: p.location.lat, lon: p.location.lon, label: p.label, address: p.addressText };
        const state: CityNavigationState = { origin };
        void navigate(`/cities/${p.cityCode}${toSearch({ origin })}`, { state });
      }}
    />
  );
}
