// End-to-end tests against the running `full` stack (scripts/e2e.sh up): testville is the active
// feed of Warsaw, car times come from the OSRM stub and addresses from the geocoder stub.
// Uses the installed Chrome (no browser download); WebGL through SwiftShader in headless mode.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'src',
  testMatch: '**/*.spec.ts',
  // One worker: the tests register accounts, which the gateway limits per client address.
  workers: 1,
  fullyParallel: false,
  // CI repeats a failed test once to record a trace and to tell flaky from broken; a test that only
  // passes the second time still fails the run.
  retries: process.env['CI'] === undefined ? 0 : 1,
  failOnFlakyTests: process.env['CI'] !== undefined,
  timeout: 300_000,
  expect: { timeout: 60_000 },
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? `http://localhost:${process.env['E2E_WEB_PORT'] ?? '8088'}`,
    channel: process.env['E2E_BROWSER_CHANNEL'] ?? 'chrome',
    headless: true,
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    // The app honours "reduce motion" (the floating city buttons stop); clicks need still targets.
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
