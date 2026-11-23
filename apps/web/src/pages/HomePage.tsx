// "/": the cities of this instance as floating buttons, a search to narrow them down, and a short
// explanation. Every city opens its own route. Links of the old format (/?city=vno&lat=..) are
// forwarded to the city route.
import { useId, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import type { City } from '../models/types.ts';
import { useAppData } from '../app/AppData.tsx';

/** "LT" -> 🇱🇹 (regional indicator letters). */
export function flag(countryCode: string): string {
  return /^[A-Z]{2}$/.test(countryCode)
    ? String.fromCodePoint(...[...countryCode].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
    : '';
}

/** Cities whose name, country or code contains the query, sorted by name. */
export function filterCities(cities: readonly City[], query: string): City[] {
  const q = query.trim().toLowerCase();
  return cities
    .filter((c) => q === '' || [c.name, c.countryCode, c.code].some((v) => v.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function HomePage() {
  const { cities, legend } = useAppData();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const searchId = useId();

  const legacy = new URLSearchParams(location.search);
  const legacyCity = legacy.get('city');
  if (legacyCity !== null && cities.some((c) => c.code === legacyCity)) {
    legacy.delete('city');
    const rest = legacy.toString();
    return <Navigate to={`/cities/${legacyCity}${rest === '' ? '' : `?${rest}`}`} replace />;
  }

  const shown = filterCities(cities, query);
  const swatches = [...legend].sort((a, b) => a.sortOrder - b.sortOrder).slice(0, 5);

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <p className="eyebrow">Public transport vs car, hexagon by hexagon</p>
        <h1 id="hero-title">How much slower is public transport than a car?</h1>
        <p className="lead">
          Pick a city and an address. Every part of the city is coloured by how long the trip takes by public transport
          compared with driving.
        </p>

        {cities.length > 6 && (
          <div className="city-search">
            <label htmlFor={searchId} className="visually-hidden">
              Find a city
            </label>
            <input
              id={searchId}
              type="search"
              placeholder="Find a city"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}

        {cities.length === 0 ? (
          <p className="hint">No city is configured on this instance yet.</p>
        ) : shown.length === 0 ? (
          <p className="hint">No city matches “{query}”.</p>
        ) : (
          <ul className="city-cloud" aria-label="Cities">
            {shown.map((city) => (
              <li key={city.code}>
                <Link to={`/cities/${city.code}`} className="city-chip">
                  <span className="city-flag" aria-hidden="true">
                    {flag(city.countryCode)}
                  </span>
                  <span className="city-name">{city.name}</span>
                  <span className={city.activeFeed === null ? 'city-state off' : 'city-state on'}>
                    {city.activeFeed === null ? 'no timetable yet' : `timetable to ${city.activeFeed.validTo}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="how" aria-labelledby="how-title">
        <h2 id="how-title" className="visually-hidden">
          How it works
        </h2>
        <ol>
          <li>
            <strong>Choose a city</strong>
            <span>Timetables come from the city's open GTFS feed.</span>
          </li>
          <li>
            <strong>Pick a start address</strong>
            <span>Search for it or click the map; choose the departure time.</span>
          </li>
          <li>
            <strong>Read the map</strong>
            <span className="swatch-row" aria-label="From as fast as a car to three times slower">
              {swatches.map((c) => (
                // Colour from the API (legend), like the map legend: the one kind of inline style used.
                <span key={c.code} className="swatch-chip" style={{ background: c.color }} title={c.label} />
              ))}
            </span>
          </li>
        </ol>
      </section>
    </>
  );
}
