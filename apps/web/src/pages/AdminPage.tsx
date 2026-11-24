// "/admin": coverage, feed import, versions and activation (admins only, see RequireAdmin).
import { AdminView } from '../features/admin/index.ts';
import { useCityData } from '../features/cities/index.ts';
import { PageTitle } from '../shared/ui/index.ts';

export function AdminPage() {
  const { cities } = useCityData();
  return (
    <>
      <PageTitle title="Administration" />
      <AdminView cities={cities} />
    </>
  );
}
