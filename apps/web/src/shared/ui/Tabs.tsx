// Segmented tabs (role tablist): click or arrow keys switch between options.
import type { KeyboardEvent } from 'react';
import './Tabs.css';

export interface TabItem<T extends string> {
  id: T;
  label: string;
}

interface Props<T extends string> {
  label: string;
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
}

export function Tabs<T extends string>({ label, items, value, onChange }: Props<T>) {
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) {
      return;
    }
    e.preventDefault();
    const index = items.findIndex((i) => i.id === value);
    const next = items[(index + step + items.length) % items.length];
    if (next !== undefined) {
      onChange(next.id);
      const tabs = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      tabs[items.indexOf(next)]?.focus();
    }
  };
  return (
    <div className="ui-tabs" role="tablist" aria-label={label} onKeyDown={move}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === value}
          tabIndex={item.id === value ? 0 : -1}
          className={item.id === value ? 'ui-tabs__tab ui-tabs__tab--active' : 'ui-tabs__tab'}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
