// "/account": profile, sign out, delete account.
import { AccountView } from '../account/AccountView.tsx';
import { useSession } from '../session/useSession.ts';

export function AccountPage() {
  const auth = useSession();
  return auth.kind === 'signed-in' ? <AccountView user={auth.user} /> : null;
}
