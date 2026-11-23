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
import { createBrowserRouter } from 'react-router';
import { AccountPage } from '../pages/AccountPage.tsx';
import { AdminPage } from '../pages/AdminPage.tsx';
import { HistoryPage } from '../pages/HistoryPage.tsx';
import { HomePage } from '../pages/HomePage.tsx';
import { MapPage } from '../pages/MapPage.tsx';
import { NotFoundPage } from '../pages/NotFoundPage.tsx';
import { PlacesPage } from '../pages/PlacesPage.tsx';
import { SignInPage } from '../pages/SignInPage.tsx';
import { RootLayout } from './AppData.tsx';
import { CityLayout } from './CityLayout.tsx';
import { RouteError } from './ErrorBoundary.tsx';
import { RequireAdmin, RequireAuth } from './guards.tsx';
import { SiteLayout } from './SiteLayout.tsx';

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      {
        path: 'cities/:code',
        element: <CityLayout />,
        errorElement: <RouteError />,
        children: [{ index: true, element: <MapPage /> }],
      },
      {
        element: <SiteLayout />,
        children: [
          {
            // Errors of a page show inside the site layout (menu stays usable).
            errorElement: <RouteError />,
            children: [
              { index: true, element: <HomePage /> },
              { path: 'sign-in', element: <SignInPage /> },
              {
                element: <RequireAuth />,
                children: [
                  { path: 'places', element: <PlacesPage /> },
                  { path: 'history', element: <HistoryPage /> },
                  { path: 'account', element: <AccountPage /> },
                  {
                    path: 'admin',
                    element: (
                      <RequireAdmin>
                        <AdminPage />
                      </RequireAdmin>
                    ),
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
