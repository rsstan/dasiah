// A signed-in user on a page their role does not allow (the admin page).

import { ButtonLink, PageTitle } from '../shared/ui/index.ts';

export function ForbiddenPage() {
  return (
    <section className="status-page" aria-labelledby="forbidden-title">
      <p className="status-code">403</p>
      <PageTitle title="No access" visible id="forbidden-title" />
      <p className="hint">This page is for administrators.</p>
      <ButtonLink to="/" variant="primary">
        See all cities
      </ButtonLink>
    </section>
  );
}
