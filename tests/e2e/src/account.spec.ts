import { expect, test } from '@playwright/test';
import { computeFrom, openWarsaw, PASSWORD, register, uniqueEmail } from './support.ts';

test('account: register, save a place, history, session after reload, delete account', async ({ page }) => {
  const email = uniqueEmail('e2e');
  await openWarsaw(page);
  await register(page, email, 'E2E User');
  await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0);

  // A map while signed in, saved as a place.
  await computeFrom(page, 'Dock Lane', /Dock Lane 12/);
  await page.getByRole('button', { name: /Save this start point/ }).click();
  await page.getByLabel('Kind').selectOption('home');
  await page.getByLabel('Name').fill('Home');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved as “Home”.' })).toBeVisible();

  // The session survives a reload (refresh cookie); the saved place is a quick pick.
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  await expect(page.locator('.quick-picks').getByRole('button', { name: 'Home' })).toBeVisible();

  const tabs = page.getByRole('navigation', { name: 'Sections' });
  await tabs.getByRole('link', { name: 'Places' }).click();
  await expect(page.locator('.items')).toContainText('Dock Lane 12');

  // History is filled from accessibility.calculation.completed.v1, asynchronously.
  await expect(async () => {
    await tabs.getByRole('link', { name: 'Cities' }).click();
    await tabs.getByRole('link', { name: 'History' }).click();
    await expect(page.locator('.items li')).not.toHaveCount(0, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.locator('.items .item-main').first().click();
  await expect(page.locator('.status.done')).toContainText('cells', { timeout: 60_000 });

  // Delete the account: signed out, and the credentials no longer work.
  await tabs.getByRole('link', { name: 'E2E User' }).click();
  await page.getByRole('button', { name: 'Delete my account…' }).click();
  await page.getByLabel('I understand that this cannot be undone').check();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.locator('form.auth-form').getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Email or password is wrong.');
});
