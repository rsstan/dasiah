// The routes. Every page is a child of the layout, so the map and the navigation stay mounted.
//   /            the map (city, start point and departure in the query string)
//   /sign-in     sign in or create an account (?next= where to return)
//   /places      saved places            signed-in users
//   /history     maps looked at before   signed-in users
//   /account     profile, sign out, delete account   signed-in users
//   /admin       feed import and activation          admins (others: forbidden page)
//   anything else: not-found page
import { createBrowserRouter } from 'react-router';
import { AccountPage } from '../pages/AccountPage.tsx';
import { AdminPage } from '../pages/AdminPage.tsx';
import { HistoryPage } from '../pages/HistoryPage.tsx';
import { MapPage } from '../pages/MapPage.tsx';
import { NotFoundPage } from '../pages/NotFoundPage.tsx';
import { PlacesPage } from '../pages/PlacesPage.tsx';
import { SignInPage } from '../pages/SignInPage.tsx';
import { AppShell } from './AppShell.tsx';
import { RequireAdmin, RequireAuth } from './guards.tsx';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <MapPage /> },
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
]);
