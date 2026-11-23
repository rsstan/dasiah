import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './app/router.tsx';
import './styles.css';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('#root is missing in index.html');
}
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
