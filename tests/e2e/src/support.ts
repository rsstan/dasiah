import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';

/** A value from the generated env file of the end-to-end stack (.e2e/.env), or the environment. */
export function e2eEnv(name: string): string {
  const fromEnv = process.env[name];
  if (fromEnv !== undefined && fromEnv !== '') {
    return fromEnv;
  }
  const file = resolve(import.meta.dirname, '../../../.e2e/.env');
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${name}=`));
  if (line === undefined) {
    throw new Error(`${name} is not set and not in .e2e/.env`);
  }
  return line.slice(name.length + 1);
}

export const PASSWORD = 'correct horse battery staple';

export const uniqueEmail = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

/** Opens the city route of Warsaw (testville is its active feed). */
export async function openWarsaw(page: Page): Promise<void> {
  await page.goto('/cities/waw');
  await expect(page.getByRole('heading', { name: /Warsaw/ })).toBeVisible();
}

/** Types an address, picks the first suggestion and waits for the map. */
export async function computeFrom(page: Page, query: string, suggestion: RegExp): Promise<void> {
  await page.getByLabel('Start address').fill(query);
  await page.getByRole('option').filter({ hasText: suggestion }).first().click();
  await expect(page.locator('.status.done')).toContainText('cells', { timeout: 60_000 });
}

export async function register(page: Page, email: string, name: string): Promise<void> {
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Name (optional)').fill(name);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  // The menu is there for everyone; the user's own link only once the registration is answered.
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name })).toBeVisible();
}
