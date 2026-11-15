import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{apps,services,packages}/*/{src,test}/**/*.test.ts', 'scripts/**/*.test.ts', 'db/**/*.test.ts'],
          exclude: ['**/node_modules/**', 'apps/web/**'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['{apps,services,packages}/*/{src,test}/**/*.itest.ts'],
          exclude: ['**/node_modules/**'],
          testTimeout: 120_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
