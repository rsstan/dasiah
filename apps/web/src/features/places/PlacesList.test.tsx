// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { City } from '../../models/types.ts';
import { mockApi, renderRoutes } from '../../shared/test/render.tsx';
import { usePlaces, type SavedPlace } from './api.ts';
import { PlacesList } from './PlacesList.tsx';

const city = (code: string, name: string): City => ({
  code,
  name,
  countryCode: 'PL',
  timezone: 'Europe/Warsaw',
  h3Resolution: 9,
  bounds: { west: 0, south: 0, east: 1, north: 1 },
  activeFeed: null,
});
const CITIES = [city('waw', 'Warsaw'), city('vno', 'Vilnius')];
const place = (placeId: string, label: string, cityCode: string, createdAt: string): SavedPlace => ({
  placeId,
  kind: 'other',
  label,
  addressText: `${label} street 1`,
  cityCode,
  location: { lat: 52.2, lon: 21 },
  createdAt,
  updatedAt: createdAt,
});
const PLACES = [
  place('p1', 'Office', 'waw', '2026-11-02T00:00:00Z'),
  place('p2', 'Home', 'vno', '2026-11-03T00:00:00Z'),
  place('p3', 'Gym', 'waw', '2026-11-01T00:00:00Z'),
];

function Harness({ onShow = vi.fn() }: { onShow?: (p: SavedPlace) => void }) {
  return <PlacesList places={usePlaces(true)} cities={CITIES} onShow={onShow} />;
}

const labels = () =>
  screen
    .getAllByRole('button')
    .filter((b) => b.classList.contains('item-main'))
    .map((b) => b.querySelector('strong')?.textContent);

describe('saved places list', () => {
  it('lists the places newest first, sorts and filters them, and keeps that in the address', async () => {
    mockApi({ 'GET /places': [200, { items: PLACES }] });
    const { router } = renderRoutes([{ path: '/places', element: <Harness /> }], '/places');
    await screen.findByText('Office');
    expect(labels()).toEqual(['Home', 'Office', 'Gym']);

    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'name');
    expect(labels()).toEqual(['Gym', 'Home', 'Office']);
    expect(router.state.location.search).toBe('?sort=name');

    await userEvent.selectOptions(screen.getByLabelText('City'), 'waw');
    expect(labels()).toEqual(['Gym', 'Office']);
    expect(router.state.location.search).toBe('?sort=name&city=waw');
  });

  it('deletes a place only after the confirmation', async () => {
    const { calls } = mockApi({ 'GET /places': [200, { items: PLACES }], 'DELETE /places/p1': [204] });
    renderRoutes([{ path: '/places', element: <Harness /> }], '/places');
    await screen.findByText('Office');
    const office = screen.getByText('Office').closest('li') as HTMLElement;

    await userEvent.click(within(office).getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this place?' });
    expect(within(dialog).getByText(/“Office” will be removed/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(calls).not.toContain('DELETE /places/p1');

    await userEvent.click(within(office).getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Office')).toBeNull());
    expect(calls).toContain('DELETE /places/p1');
  });

  it('shows a rename conflict at the name field', async () => {
    mockApi({
      'GET /places': [200, { items: PLACES }],
      'PATCH /places/p3': [409, { type: '/problems/duplicate-label', title: 'Conflict', status: 409 }],
    });
    renderRoutes([{ path: '/places', element: <Harness /> }], '/places');
    const gym = (await screen.findByText('Gym')).closest('li') as HTMLElement;
    await userEvent.click(within(gym).getByRole('button', { name: 'Rename' }));
    const field = screen.getByLabelText('New name');
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('A name is required.')).toBeTruthy();

    await userEvent.type(field, 'Home');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('You already have a place with this name.')).toBeTruthy();
  });

  it('opens a place on the map', async () => {
    mockApi({ 'GET /places': [200, { items: PLACES }] });
    const onShow = vi.fn();
    renderRoutes([{ path: '/places', element: <Harness onShow={onShow} /> }], '/places');
    await userEvent.click(await screen.findByText('Home'));
    expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ placeId: 'p2' }));
  });
});
