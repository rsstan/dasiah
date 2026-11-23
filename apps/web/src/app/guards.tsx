// Route guards. While the session is being restored from the refresh cookie nothing is decided
// yet; a signed-out visitor is sent to the sign-in page and comes back afterwards; a user who
// signs out or deletes the account while on such a page goes to the map; a signed-in user
// without the admin role gets the forbidden page.
import { useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { ForbiddenPage } from '../pages/ForbiddenPage.tsx';
import { useSession } from '../session/useSession.ts';

export function RequireAuth() {
  const auth = useSession();
  const location = useLocation();
  const [wasSignedIn, setWasSignedIn] = useState(auth.kind === 'signed-in');
  if (auth.kind === 'signed-in' && !wasSignedIn) {
    setWasSignedIn(true);
  }
  if (auth.kind === 'unknown') {
    return (
      <p className="hint" role="status">
        Checking your session…
      </p>
    );
  }
  if (auth.kind === 'signed-out' && wasSignedIn) {
    return <Navigate to="/" replace />;
  }
  if (auth.kind === 'signed-out') {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/sign-in?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const auth = useSession();
  if (auth.kind === 'signed-in' && auth.user.role !== 'admin') {
    return <ForbiddenPage />;
  }
  return children;
}

/** Where to go after signing in: only paths inside the application. */
export function safeNext(next: string | null): string {
  return next !== null && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
