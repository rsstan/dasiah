// "/account": profile, sign out, delete account.
import { AccountView } from '../features/account/index.ts';
import { useSession } from '../features/auth/index.ts';
import { PageTitle } from '../shared/ui/index.ts';

export function AccountPage() {
  const auth = useSession();
  return auth.kind === 'signed-in' ? (
    <>
      <PageTitle title="Account" />
      <AccountView user={auth.user} />
    </>
  ) : null;
}
