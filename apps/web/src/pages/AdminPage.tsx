// "/admin": coverage, feed import, versions and activation (admins only, see RequireAdmin).
import { AdminView } from '../admin/AdminView.tsx';
import { useAppData } from '../app/AppData.tsx';

export function AdminPage() {
  const { cities } = useAppData();
  return <AdminView cities={cities} />;
}
