// "City: all / Vilnius / Warsaw ..." above a list; offers only the cities present in it.
import type { City } from '../../models/types.ts';
import { Select } from '../../shared/ui/index.ts';

interface Props {
  cities: readonly City[];
  /** City codes present in the list. */
  present: readonly string[];
  value: string;
  onChange: (code: string) => void;
}

export function CityFilter({ cities, present, value, onChange }: Props) {
  const options = cities.filter((c) => present.includes(c.code)).sort((a, b) => a.name.localeCompare(b.name));
  if (options.length < 2) {
    return null;
  }
  return (
    <Select inline className="city-filter" label="City" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All cities</option>
      {options.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </Select>
  );
}
