// Light or dark. The user's choice (system, light, dark) is kept in localStorage; "system"
// follows the operating system and changes with it. index.html applies the stored choice before
// the first paint (no flash of the wrong theme); this module keeps <html data-theme> up to date
// and lets components read and change the theme.
import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export interface ThemeState {
  choice: ThemeChoice;
  /** The theme in effect: the choice, or the system's for "system". */
  theme: Theme;
}

/** Also read by the early script in index.html. */
export const THEME_KEY = 'heatmap.theme';
const CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

function systemTheme(): Theme {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function storedChoice(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return CHOICES.find((c) => c === value) ?? 'system';
  } catch {
    // Storage blocked (private mode, policies): follow the system.
    return 'system';
  }
}

const listeners = new Set<() => void>();
let state: ThemeState = resolve(storedChoice());

function resolve(choice: ThemeChoice): ThemeState {
  return { choice, theme: choice === 'system' ? systemTheme() : choice };
}

function publish(next: ThemeState) {
  state = next;
  document.documentElement.dataset['theme'] = next.theme;
  for (const listener of listeners) {
    listener();
  }
}

export function setTheme(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Not remembered, but still applied for this page.
  }
  publish(resolve(choice));
}

/** The next choice of the menu button: system -> light -> dark -> system. */
export function nextChoice(choice: ThemeChoice): ThemeChoice {
  return CHOICES[(CHOICES.indexOf(choice) + 1) % CHOICES.length] as ThemeChoice;
}

export function getTheme(): ThemeState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): ThemeState {
  return useSyncExternalStore(subscribe, getTheme);
}

/** Applies the theme and follows the system while the choice is "system". Called once at start. */
export function watchTheme(): () => void {
  publish(resolve(state.choice));
  if (typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (state.choice === 'system') {
      publish(resolve('system'));
    }
  };
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
