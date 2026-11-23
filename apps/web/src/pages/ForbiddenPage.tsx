// A signed-in user on a page their role does not allow (the admin page).

import { ButtonLink } from '../shared/ui/index.ts';

export function ForbiddenPage() {
  return (
    <section className="status-page" aria-labelledby="forbidden-title">
      <p className="status-code">403</p>
      <h2 id="forbidden-title">No access</h2>
      <p className="hint">This page is for administrators.</p>
      <ButtonLink to="/" variant="primary">
        See all cities
      </ButtonLink>
    </section>
  );
}
