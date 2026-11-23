// The site menu, the same on every page: brand, cities, and for a signed-in user places,
// history, admin (admins) and the account; otherwise "Sign in", which returns to the current page.
import { Link, NavLink, useLocation } from 'react-router';
import { useSession } from '../features/auth/useSession.ts';

export function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Transit Heatmap, home">
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <polygon points="16,2 28,9 28,23 16,30 4,23 4,9" />
        <polygon className="inner" points="16,9 22,12.5 22,19.5 16,23 10,19.5 10,12.5" />
      </svg>
      <span>Transit Heatmap</span>
    </Link>
  );
}

export function SiteNav() {
  const auth = useSession();
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;
  return (
    <nav className="site-nav" aria-label="Sections">
      <NavLink to="/" end>
        Cities
      </NavLink>
      {auth.kind === 'signed-in' && (
        <>
          <NavLink to="/places">Places</NavLink>
          <NavLink to="/history">History</NavLink>
          {auth.user.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
          <NavLink to="/account">{auth.user.displayName ?? 'Account'}</NavLink>
        </>
      )}
      {auth.kind === 'signed-out' && location.pathname !== '/sign-in' && (
        <Link to={`/sign-in?next=${encodeURIComponent(here)}`} className="nav-cta">
          Sign in
        </Link>
      )}
    </nav>
  );
}
