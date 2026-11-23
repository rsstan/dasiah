// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { requestPageFocus, takePageFocus } from '../lib/pageFocus.ts';
import { PageTitle } from './PageTitle.tsx';

afterEach(() => {
  cleanup();
  takePageFocus();
});

describe('PageTitle', () => {
  it('names the document and is the one h1 of the page', () => {
    render(<PageTitle title="Saved places" />);
    expect(document.title).toBe('Saved places · Transit Heatmap');
    const heading = screen.getByRole('heading', { level: 1, name: 'Saved places' });
    expect(heading.className).toBe('visually-hidden');
  });

  it('takes the focus only after a route change asked for it, once', () => {
    render(<PageTitle title="History" visible />);
    expect(document.activeElement).toBe(document.body); // first load: the focus stays

    cleanup();
    requestPageFocus();
    render(<PageTitle title="Account" visible />);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Account' }));
    expect(takePageFocus()).toBe(false); // used up
  });
});
