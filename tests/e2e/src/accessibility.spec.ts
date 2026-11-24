// Accessibility (docs/plan.md 8A.10): every page passes axe (WCAG 2.1 A and AA, including colour
// contrast, and axe's best practices) in the light and the dark theme, and the main flow works
// with the keyboard alone: skip link, focus moved to the new page after a navigation, address
// suggestions chosen with the arrows.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { e2eEnv } from './support.ts';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

/** axe on the current page; a failure lists rule, impact and the offending elements. */
async function expectNoViolations(page: Page, name: string): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(TAGS)
    // The WebGL canvas is the picture of the map; its text alternative is the panel (status,
    // legend, the class chart) and the cell popups.
    .exclude('.maplibregl-canvas')
    .analyze();
  const found = result.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
  }));
  expect(found, `axe violations on ${name}`).toEqual([]);
}

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('demo.admin@example.com');
  await page.getByLabel('Password').fill(e2eEnv('SEED_DEMO_PASSWORD'));
  await page.locator('form.auth-form').getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('link', { name: 'Admin', exact: true })).toBeVisible();
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`accessibility, ${theme} theme`, () => {
    test.use({ colorScheme: theme });

    test('public pages pass axe', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoViolations(page, 'home');

      await page.goto('/sign-in');
      await expect(page.getByRole('tab', { name: 'Sign in' })).toBeVisible();
      await expectNoViolations(page, 'sign-in');

      // A computed map: panel with status, legend and the class chart; a cell popup open.
      await page.goto('/cities/waw?lat=52.2002&lon=21.0302');
      const map = page.locator('.map');
      await expect(map).toHaveAttribute('data-cells', 'ready', { timeout: 60_000 });
      await expect(page.getByRole('heading', { name: 'This map by class' })).toBeVisible();
      await expectNoViolations(page, 'city map');

      await page.goto('/no/such/page');
      await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
      await expectNoViolations(page, '404');
    });

    test('pages of a signed-in user pass axe', async ({ page }) => {
      await signInAsAdmin(page);
      for (const [path, heading] of [
        ['/places', /Saved places/],
        ['/history', /History|Maps you looked at/],
        ['/account', /Account|Profile/],
        ['/admin', /Coverage|Feed/],
      ] as const) {
        await page.goto(path);
        await expect(page.getByRole('heading', { name: heading }).first()).toBeAttached();
        await page.waitForLoadState('networkidle');
        await expectNoViolations(page, path);
      }
    });
  });
}

test('keyboard only: skip link, focus after navigation, address suggestions', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); // past the loading screen
  // The first Tab reaches the skip link, which moves the focus to the content.
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#content')).toBeFocused();

  // Tab to the Warsaw button and open it: the focus lands on the city heading.
  const warsaw = page.getByRole('link', { name: /Warsaw/ });
  for (let i = 0; i < 10 && !(await warsaw.evaluate((el) => el === document.activeElement)); i += 1) {
    await page.keyboard.press('Tab');
  }
  await expect(warsaw).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/cities\/waw/);
  await expect(page.getByRole('heading', { level: 1, name: /Warsaw/ })).toBeFocused();
  await expect(page).toHaveTitle('Warsaw · Transit Heatmap');

  // The address box: type, move to the second suggestion with the arrows, pick it with Enter.
  const box = page.getByRole('combobox', { name: 'Start address' });
  await box.focus();
  await page.keyboard.type('Station');
  const options = page.getByRole('option');
  await expect(options.first()).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await expect(box).toHaveAttribute('aria-activedescendant', (await options.first().getAttribute('id')) ?? '');
  const chosen = (await options.first().textContent()) ?? '';
  await page.keyboard.press('Enter');
  await expect(box).toHaveValue(chosen);
  await expect(page.locator('.status.done')).toContainText('cells', { timeout: 60_000 });
  await expect(box).toBeFocused();

  // Back to the cities with the menu link, by keyboard: the home heading takes the focus.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Cities' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
});
