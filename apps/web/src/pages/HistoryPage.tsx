// "/history": maps the user looked at, in every city; one click reopens the map in its city.
import { cellToLatLng } from 'h3-js';
import { useNavigate } from 'react-router';
import { HistoryList } from '../features/history/index.ts';
import { useCityData } from '../features/cities/index.ts';
import { type CityNavigationState, toSearch } from '../features/map/index.ts';

export function HistoryPage() {
  const { cities } = useCityData();
  const navigate = useNavigate();
  return (
    <HistoryList
      cities={cities}
      onOpen={(entry) => {
        const [lat, lon] = cellToLatLng(entry.originH3);
        const state: CityNavigationState = { history: entry };
        void navigate(`/cities/${entry.cityCode}${toSearch({ origin: { lat, lon, label: '' } })}`, { state });
      }}
    />
  );
}
