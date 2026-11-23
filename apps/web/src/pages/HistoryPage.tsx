// "/history": maps the user looked at, in every city; one click reopens the map in its city.
import { cellToLatLng } from 'h3-js';
import { useNavigate } from 'react-router';
import { HistoryList } from '../account/HistoryList.tsx';
import { useAppData } from '../app/AppData.tsx';
import type { CityNavigationState } from '../app/MapState.tsx';
import { toSearch } from '../urlState.ts';

export function HistoryPage() {
  const { cities } = useAppData();
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
