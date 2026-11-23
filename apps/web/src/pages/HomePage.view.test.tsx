// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { City } from '../models/types.ts';
import { AppDataContext } from '../app/AppData.tsx';
import { renderRoutes } from '../shared/test/render.tsx';
import { HomePage } from './HomePage.tsx';

const city = (code: string, name: string, withFeed: boolean): City => ({
  code,
  name,
  countryCode: 'PL',
  timezone: 'Europe/Warsaw',
  h3Resolution: 9,
  bounds: { west: 0, south: 0, east: 1, north: 1 },
  activeFeed: withFeed ? { feedVersionId: 1, cityCode: code, validFrom: '2026-11-01', validTo: '2027-03-31' } : null,
});
const names = ['Warsaw', 'Kraków', 'Gdańsk', 'Wrocław', 'Poznań', 'Łódź', 'Vilnius'];
const CITIES = names.map((n, i) => city(n.slice(0, 3).toLowerCase(), n, i % 2 === 0));

function renderHome(cities: City[]) {
  return renderRoutes(
    [
      {
        path: '/',
        element: (
          <AppDataContext value={{ cities, legend: [] }}>
            <HomePage />
          </AppDataContext>
        ),
      },
      { path: '/cities/:code', element: <h1>City page</h1> },
    ],
    '/',
  );
}

describe('home page', () => {
  it('shows every city as a link to its route, with its timetable state', async () => {
    const { router } = renderHome(CITIES);
    const list = screen.getByRole('list', { name: 'Cities' });
    expect(list.querySelectorAll('a')).toHaveLength(7);
    expect(screen.getByRole('link', { name: /Warsaw.*timetable to 2027-03-31/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Kraków.*no timetable yet/ })).toBeTruthy();
    await userEvent.click(screen.getByRole('link', { name: /Vilnius/ }));
    expect(router.state.location.pathname).toBe('/cities/vil');
  });

  it('filters the cities with the search when there are many', async () => {
    renderHome(CITIES);
    await userEvent.type(screen.getByLabelText('Find a city'), 'w');
    const shown = Array.from(screen.getByRole('list', { name: 'Cities' }).querySelectorAll('.city-name')).map(
      (e) => e.textContent,
    );
    expect(shown).toEqual(['Kraków', 'Warsaw', 'Wrocław']);
    await userEvent.type(screen.getByLabelText('Find a city'), 'xyz');
    expect(screen.getByText(/No city matches/)).toBeTruthy();
  });
});
