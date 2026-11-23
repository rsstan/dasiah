// "City: all / Vilnius / Warsaw ..." above a list; offers only the cities present in it.
import { useId } from 'react';
import type { City } from '../api/types.ts';

interface Props {
  cities: readonly City[];
  /** City codes present in the list. */
  present: readonly string[];
  value: string;
  onChange: (code: string) => void;
}

export function CityFilter({ cities, present, value, onChange }: Props) {
  const id = useId();
  const options = cities.filter((c) => present.includes(c.code)).sort((a, b) => a.name.localeCompare(b.name));
  if (options.length < 2) {
    return null;
  }
  return (
    <div className="city-filter">
      <label htmlFor={id}>City</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All cities</option>
        {options.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
