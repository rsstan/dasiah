// Any unknown address.
import { Link, useLocation } from 'react-router';

export function NotFoundPage() {
  const location = useLocation();
  return (
    <section className="status-page" aria-labelledby="not-found-title">
      <p className="status-code">404</p>
      <h2 id="not-found-title">Page not found</h2>
      <p className="hint">
        There is nothing at <code>{location.pathname}</code>.
      </p>
      <Link to="/">See all cities</Link>
    </section>
  );
}
