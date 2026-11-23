// "/admin": coverage, feed import, versions and activation (admins only, see RequireAdmin).
import { AdminView } from '../admin/AdminView.tsx';
import { useMapState } from '../app/MapState.tsx';

export function AdminPage() {
  const { cities } = useMapState();
  return <AdminView cities={cities} />;
}
