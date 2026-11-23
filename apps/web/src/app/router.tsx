// The routes. Pages without a map share the site layout (menu on top); a city has its own layout
// with the side panel and the map. Cities come from the API, so any number of them works.
//   /                 home: the cities of this instance
//   /cities/:code     the map of one city (?lat=&lon=&date=&time= for a shared map)
//   /sign-in          sign in or create an account (?next= where to return)
//   /places           saved places, every city        signed-in users
//   /history          maps looked at before            signed-in users
//   /account          profile, sign out, delete        signed-in users
//   /admin            feed import and activation       admins (others: forbidden page)
//   anything else     not-found page
// Pages are loaded on demand (one chunk each), see below.
import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter } from 'react-router';
import { HomePage } from '../pages/HomePage.tsx';
import { NotFoundPage } from '../pages/NotFoundPage.tsx';
import { requestPageFocus } from '../shared/lib/pageFocus.ts';
import { Skeleton } from '../shared/ui/index.ts';
import { RootLayout } from './AppData.tsx';
import { CityLayout } from './CityLayout.tsx';
import { RouteError } from './ErrorBoundary.tsx';
import { RequireAdmin, RequireAuth } from './guards.tsx';
import { SiteLayout } from './SiteLayout.tsx';

// Every page except the home and not-found pages is its own chunk, loaded when its route is first
// opened; meanwhile a skeleton takes its place (the layout around it stays).
const MapPage = lazy(() => import('../pages/MapPage.tsx').then((m) => ({ default: m.MapPage })));
const SignInPage = lazy(() => import('../pages/SignInPage.tsx').then((m) => ({ default: m.SignInPage })));
const PlacesPage = lazy(() => import('../pages/PlacesPage.tsx').then((m) => ({ default: m.PlacesPage })));
const HistoryPage = lazy(() => import('../pages/HistoryPage.tsx').then((m) => ({ default: m.HistoryPage })));
const AccountPage = lazy(() => import('../pages/AccountPage.tsx').then((m) => ({ default: m.AccountPage })));
const AdminPage = lazy(() => import('../pages/AdminPage.tsx').then((m) => ({ default: m.AdminPage })));

function page(element: ReactNode) {
  return <Suspense fallback={<Skeleton lines={4} variant="card" />}>{element}</Suspense>;
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      {
        path: 'cities/:code',
        element: <CityLayout />,
        errorElement: <RouteError />,
        children: [{ index: true, element: page(<MapPage />) }],
      },
      {
        element: <SiteLayout />,
        children: [
          {
            // Errors of a page show inside the site layout (menu stays usable).
            errorElement: <RouteError />,
            children: [
              { index: true, element: <HomePage /> },
              { path: 'sign-in', element: page(<SignInPage />) },
              {
                element: <RequireAuth />,
                children: [
                  { path: 'places', element: page(<PlacesPage />) },
                  { path: 'history', element: page(<HistoryPage />) },
                  { path: 'account', element: page(<AccountPage />) },
                  {
                    path: 'admin',
                    element: <RequireAdmin>{page(<AdminPage />)}</RequireAdmin>,
                  },
                ],
              },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
]);

// After a move to another page (not on the first load, not when only the query changes) the new
// page's heading takes the focus (shared/ui/PageTitle.tsx). The router notifies before React
// renders the new page, so the request is there when the page mounts, lazy or not.
let lastPath = router.state.location.pathname;
router.subscribe((state) => {
  if (state.location.pathname !== lastPath) {
    lastPath = state.location.pathname;
    requestPageFocus();
  }
});
