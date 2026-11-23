// "/history": maps the user looked at; one click opens it on the map.
import { useNavigate } from 'react-router';
import { HistoryList } from '../account/HistoryList.tsx';
import { useMapState } from '../app/MapState.tsx';

export function HistoryPage() {
  const { cities, openHistory } = useMapState();
  const navigate = useNavigate();
  return (
    <HistoryList
      cities={cities}
      onOpen={(entry) => {
        openHistory(entry);
        void navigate('/');
      }}
    />
  );
}
