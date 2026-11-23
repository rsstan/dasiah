// Any unknown address.
import { useLocation } from 'react-router';
import { ButtonLink } from '../shared/ui/index.ts';

export function NotFoundPage() {
  const location = useLocation();
  return (
    <section className="status-page" aria-labelledby="not-found-title">
      <p className="status-code">404</p>
      <h2 id="not-found-title">Page not found</h2>
      <p className="hint">
        There is nothing at <code>{location.pathname}</code>.
      </p>
      <ButtonLink to="/" variant="primary">
        See all cities
      </ButtonLink>
    </section>
  );
}
