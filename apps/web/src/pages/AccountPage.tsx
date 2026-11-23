// "/account": profile, sign out, delete account.
import { AccountView } from '../features/account/index.ts';
import { useSession } from '../features/auth/index.ts';

export function AccountPage() {
  const auth = useSession();
  return auth.kind === 'signed-in' ? <AccountView user={auth.user} /> : null;
}
