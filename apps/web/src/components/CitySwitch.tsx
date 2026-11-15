import type { City } from '../api/types.ts';

interface Props {
  cities: readonly City[];
  value: string;
  onChange: (code: string) => void;
}

export function CitySwitch({ cities, value, onChange }: Props) {
  return (
    <div className="city-switch" role="radiogroup" aria-label="City">
      {cities.map((city) => (
        <button
          key={city.code}
          type="button"
          role="radio"
          aria-checked={city.code === value}
          className={city.code === value ? 'active' : ''}
          onClick={() => onChange(city.code)}
        >
          {city.name}
        </button>
      ))}
    </div>
  );
}
