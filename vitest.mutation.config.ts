// Unit tests of the modules that Stryker mutates (pnpm test:mutation, stryker.config.json).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'services/accessibility/src/{raptor,calculation}/**/*.test.ts',
      'services/transit-data/src/timetable/*.test.ts',
      'services/identity/src/domain/*.test.ts',
      'services/places/src/geocoding/*.test.ts',
      'apps/gateway/src/auth.test.ts',
      'packages/common/src/geo*.test.ts',
    ],
  },
});
