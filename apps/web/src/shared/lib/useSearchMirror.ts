// Keeps the query string of the current page equal to `search`. The router moves on before React
// renders the next page, so an effect of the old page can run when the address already belongs to
// the new one; writing then would replace the new page's query (it took ?next= from the sign-in
// page). The effect therefore compares its own path with the router's current one.
import { use, useEffect } from 'react';
import { UNSAFE_DataRouterContext, useLocation, useSearchParams } from 'react-router';

export function useSearchMirror(search: string): void {
  // The only synchronous view of the router's position; useLocation is what React last rendered.
  const router = use(UNSAFE_DataRouterContext)?.router;
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (router !== undefined && router.state.location.pathname !== pathname) {
      return;
    }
    const current = params.toString();
    if ((current === '' ? '' : `?${current}`) !== search) {
      setParams(new URLSearchParams(search), { replace: true });
    }
  }, [router, pathname, search, params, setParams]);
}
