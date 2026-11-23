// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, renderRoutes } from '../../shared/test/render.tsx';
import { AddressSearch } from './AddressSearch.tsx';

const CANDIDATES = [
  { displayName: 'Central Station, Station Road 1', lat: 52.2, lon: 21.03 },
  { displayName: 'Central Park, Park Lane 2', lat: 52.21, lon: 21.01 },
  { displayName: 'Central Library, Book Street 3', lat: 52.22, lon: 21.02 },
];

function setup() {
  mockApi({ 'GET /geocode': [200, { items: CANDIDATES }] });
  const onSelect = vi.fn();
  renderRoutes(<AddressSearch cityCode="waw" selected={undefined} onSelect={onSelect} />);
  const box = screen.getByRole('combobox', { name: 'Start address' });
  return { onSelect, box, user: userEvent.setup() };
}

describe('address search with the keyboard', () => {
  it('moves through the suggestions with the arrows and picks with Enter', async () => {
    const { onSelect, box, user } = setup();
    await user.type(box, 'Central');
    const options = await screen.findAllByRole('option', {}, { timeout: 2_000 });
    expect(options).toHaveLength(3);
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(box.getAttribute('aria-activedescendant')).toBeNull();

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(options[1]?.getAttribute('aria-selected')).toBe('true');
    expect(box.getAttribute('aria-activedescendant')).toBe(options[1]?.id);
    await user.keyboard('{ArrowDown}{ArrowDown}'); // stops at the last one
    expect(options[2]?.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowUp}');
    expect(options[1]?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(box);

    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(CANDIDATES[1]);
    expect((box as HTMLInputElement).value).toBe(CANDIDATES[1]?.displayName);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Enter without a highlight picks the first suggestion; Escape closes the list', async () => {
    const { onSelect, box, user } = setup();
    await user.type(box, 'Central');
    await screen.findAllByRole('option', {}, { timeout: 2_000 });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(box.getAttribute('aria-expanded')).toBe('false');
    expect(onSelect).not.toHaveBeenCalled();

    await user.type(box, ' ');
    await screen.findAllByRole('option', {}, { timeout: 2_000 });
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(CANDIDATES[0]);
  });
});
