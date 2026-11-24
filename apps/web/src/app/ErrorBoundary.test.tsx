// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../shared/lib/logger.ts';
import { AppErrorBoundary, RouteError } from './ErrorBoundary.tsx';

function Broken(): never {
  throw new Error('render failed');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('error boundaries', () => {
  it('shows the fallback with a reference instead of a blank page and logs the error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'The application failed' })).toBeTruthy();
    expect(screen.getByText(/quote this reference: [0-9a-f]{8}/)).toBeTruthy();
    expect(logger.recent().at(-1)).toMatchObject({ level: 'error', message: 'application failed to render' });
  });

  it('catches the error of one route page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const router = createMemoryRouter([{ path: '/', element: <Broken />, errorElement: <RouteError /> }]);
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { name: 'This page failed' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeTruthy();
  });
});
