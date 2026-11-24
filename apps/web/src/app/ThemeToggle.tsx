// Menu button for the theme: system -> light -> dark. The icon shows the current choice; the
// accessible name says it and what a press does.
import { nextChoice, setTheme, useTheme, type ThemeChoice } from '../shared/lib/theme.ts';

const LABEL: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' };

export function ThemeToggle() {
  const { choice } = useTheme();
  const next = nextChoice(choice);
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Theme: ${LABEL[choice]}. Switch to ${LABEL[next].toLowerCase()}`}
      title={`Theme: ${LABEL[choice]}`}
      onClick={() => setTheme(next)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {choice === 'light' && (
          <>
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
          </>
        )}
        {choice === 'dark' && <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />}
        {choice === 'system' && (
          <>
            <circle cx="12" cy="12" r="8.5" />
            <path className="filled" d="M12 3.5a8.5 8.5 0 0 1 0 17Z" />
          </>
        )}
      </svg>
    </button>
  );
}
