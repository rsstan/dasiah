// Helpers for component tests (jsdom): render inside a memory router and a fresh query client
// (no retries, no cache shared between tests), answer API calls from a table, and the bits jsdom
// lacks (<dialog> modal methods). Imported by tests only.
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { afterEach, vi } from 'vitest';
import { createQueryClient } from '../api/queryClient.ts';
import { forgetParams } from '../lib/useParam.ts';

// jsdom has <dialog> but not its modal methods.
if (typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  forgetParams();
});

export type Answer = [status: number, body?: unknown];
/** "GET /places" -> answer, or a function of the request body. */
export type ApiTable = Record<string, Answer | ((body: unknown) => Answer)>;

/** Replaces fetch: answers from the table (path without /api/v1 and query), records calls. */
export function mockApi(table: ApiTable): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url, 'http://test').pathname.replace(/^\/api\/v1/, '');
      const key = `${init.method ?? 'GET'} ${path}`;
      calls.push(key);
      const entry = table[key];
      const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      const [status, payload] =
        entry === undefined
          ? [404, { title: `no mock for ${key}` }]
          : typeof entry === 'function'
            ? entry(body)
            : entry;
      return new Response(payload === undefined ? null : JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json', 'x-correlation-id': 'test-correlation' },
      });
    }),
  );
  return { calls };
}

/** Renders routes (or one element at `path`) at `url` with a fresh query client. */
export function renderRoutes(
  routes: RouteObject[] | ReactNode,
  url = '/',
): RenderResult & { router: ReturnType<typeof createMemoryRouter> } {
  const table: RouteObject[] = Array.isArray(routes) ? routes : [{ path: '*', element: routes }];
  const router = createMemoryRouter(table, { initialEntries: [url] });
  const result = render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...result, router };
}
