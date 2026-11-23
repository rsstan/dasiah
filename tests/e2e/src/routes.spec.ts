import { expect, test } from '@playwright/test';
import { e2eEnv } from './support.ts';

test.describe('routes', () => {
  test('an unknown address shows the not-found page', async ({ page }) => {
    await page.goto('/no/such/page');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.getByRole('link', { name: 'Go to the map' }).click();
    await expect(page).toHaveURL(/\/(\?.*)?$/);
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
    await page.goto('/account');
    await page.reload();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  });
});
