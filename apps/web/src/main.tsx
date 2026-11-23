import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { AppProviders } from './app/providers.tsx';
import { router } from './app/router.tsx';
import { watchTheme } from './shared/lib/theme.ts';
import './styles/tokens.css';
import './styles/base.css';
import './styles/index.css';

watchTheme();

const root = document.getElementById('root');
if (root === null) {
  throw new Error('#root is missing in index.html');
}
createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
