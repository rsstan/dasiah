import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    reporters: process.env['CI'] === undefined ? ['default'] : ['default', 'github-actions', 'junit'],
    outputFile: { junit: 'reports/junit.xml' },
    // `pnpm test:cov`: unit and integration tests in one report (coverage/index.html). Every source
    // file counts, also files no test imports.
    coverage: {
      provider: 'v8',
      include: ['{apps,services,packages}/*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.{test,itest}.{ts,tsx}',
        '**/generated/**', // produced from the contracts
        'packages/testing/**', // containers and helpers of the tests themselves
        '**/test-support/**', // stubs of OSRM, geocoder, transit-data
        '**/test-support.ts',
        '**/shared/test/**',
        '**/*.d.ts',
      ],
      reporter: ['text-summary', 'html', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      reportOnFailure: true,
      // Quality gate of the back end. The web client is reported, its gate is the component and
      // end-to-end suites (specs/testing.md).
      thresholds: {
        // No workspace hides behind the others.
        ...Object.fromEntries(
          [
            'apps/gateway',
            'services/identity',
            'services/transit-data',
            'services/accessibility',
            'services/places',
            'packages/common',
            'packages/contracts',
          ].map((w) => [`${w}/src/**`, { lines: 85, branches: 70, functions: 80 }]),
        ),
        '{apps/gateway,services/*,packages/{common,contracts}}/src/**': {
          lines: 90,
          branches: 78,
          functions: 90,
          statements: 90,
        },
      },
    },
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            '{apps,services,packages}/*/{src,test}/**/*.test.{ts,tsx}',
            'scripts/**/*.test.ts',
            'db/**/*.test.ts',
          ],
          exclude: ['**/node_modules/**'],
          // Only to end a hanging test; no test depends on the speed of the machine.
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['{apps,services,packages,tests}/*/{src,test}/**/*.itest.ts'],
          exclude: ['**/node_modules/**'],
          testTimeout: 300_000,
          hookTimeout: 600_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
