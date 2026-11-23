import { expect, test } from '@playwright/test';
import { e2eEnv } from './support.ts';

test.describe('routes', () => {
  test('home lists the cities; each opens its own route; unknown code and old links', async ({ page }) => {
    await page.goto('/');
    const cities = page.getByRole('list', { name: 'Cities' });
    await expect(cities.getByRole('link')).toHaveCount(2);
    await cities.getByRole('link', { name: /Warsaw/ }).click();
    await expect(page).toHaveURL(/\/cities\/waw$/);
    await expect(page.getByRole('heading', { name: /Warsaw/ })).toBeVisible();
    await page.getByRole('link', { name: '← All cities' }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto('/cities/xyz');
    await expect(page.getByRole('heading', { name: 'City not found' })).toBeVisible();

    // A link in the format before city routes still opens the same map.
    await page.goto('/?city=waw&lat=52.2002&lon=21.0302');
    await expect(page).toHaveURL(/\/cities\/waw\?lat=52\.2002&lon=21\.0302/);
  });

  test('an unknown address shows the not-found page', async ({ page }) => {
    await page.goto('/no/such/page');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.getByRole('link', { name: 'See all cities' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('a protected page sends to sign-in and back; navigation, back and forward; admin page forbidden', async ({
    page,
  }) => {
    await page.goto('/places');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fplaces$/);
    await page.getByLabel('Email').fill('demo.user@example.com');
    await page.getByLabel('Password').fill(e2eEnv('SEED_DEMO_PASSWORD'));
    await page.locator('form.auth-form').getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/places$/);
    await expect(page.getByRole('heading', { name: /Saved places/ })).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Sections' });
    await nav.getByRole('link', { name: 'History' }).click();
    await expect(page).toHaveURL(/\/history$/);
    await expect(nav.getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(page).toHaveURL(/\/places$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/history$/);

    // Not an admin: the address exists but is not allowed.
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0);

    // Reloading a page keeps it (session restored from the cookie).
    // A reload right after loading may cut the token refresh short; identity's grace period keeps
    // the session (the just-rotated token is accepted once).
    await page.goto('/account');
    await page.reload();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  });
});
