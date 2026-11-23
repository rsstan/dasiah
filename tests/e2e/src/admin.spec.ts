import { expect, test } from '@playwright/test';
import { e2eEnv } from './support.ts';

test('admin: coverage and feed versions; unknown source refused', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill('demo.admin@example.com');
  await page.getByLabel('Password').fill(e2eEnv('SEED_DEMO_PASSWORD'));
  await page.locator('form.auth-form').getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Admin', exact: true }).click();
  const coverage = page.locator('table.coverage');
  await expect(coverage.getByRole('row', { name: /Warsaw/ })).toContainText('%');
  await expect(page.locator('.version').filter({ hasText: 'Warsaw' }).first()).toContainText('active');

  await page.getByLabel('Feed source').fill('nope');
  await page.getByRole('button', { name: 'Download and import' }).click();
  await expect(page.locator('.import [role=alert]')).toContainText('Unknown feed source');
});
