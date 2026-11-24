// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A controllable prefers-color-scheme for the module under test. */
function stubSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: dark,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  vi.stubGlobal('matchMedia', () => media);
  return {
    set(next: boolean) {
      media.matches = next;
      for (const l of listeners) l();
    },
  };
}

// The module reads storage and the system when it is loaded: import it fresh in every test.
async function load() {
  vi.resetModules();
  return import('./theme.ts');
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('theme', () => {
  it('follows the system until the user chooses, and remembers the choice', async () => {
    const system = stubSystem(true);
    const theme = await load();
    const stop = theme.watchTheme();
    expect(theme.getTheme()).toEqual({ choice: 'system', theme: 'dark' });
    expect(document.documentElement.dataset['theme']).toBe('dark');

    system.set(false);
    expect(theme.getTheme().theme).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');

    theme.setTheme('dark');
    expect(localStorage.getItem(theme.THEME_KEY)).toBe('dark');
    system.set(false); // the system no longer matters
    expect(theme.getTheme()).toEqual({ choice: 'dark', theme: 'dark' });
    stop();

    const again = await load(); // a reload
    expect(again.getTheme()).toEqual({ choice: 'dark', theme: 'dark' });
  });

  it('cycles system, light, dark; an unknown stored value means system', async () => {
    stubSystem(false);
    localStorage.setItem('heatmap.theme', 'purple');
    const theme = await load();
    expect(theme.getTheme().choice).toBe('system');
    expect(['system', 'light', 'dark'].map((c) => theme.nextChoice(c as 'system'))).toEqual([
      'light',
      'dark',
      'system',
    ]);
  });
});
