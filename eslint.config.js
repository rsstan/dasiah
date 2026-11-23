import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'packages/contracts/src/generated/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-syntax': ['error', { selector: 'ExportDefaultDeclaration', message: 'Use named exports.' }],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // Web layers: only shared/api and the api modules of the features call the server; components
    // and pages use their hooks (TanStack Query) instead of requesting directly.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: [
      'apps/web/src/shared/api/**',
      'apps/web/src/features/*/api.ts',
      'apps/web/src/features/*/api/**',
      'apps/web/src/features/auth/session.ts',
      'apps/web/src/**/*.test.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/shared/api/client.ts'],
              importNames: ['request', 'setAuthHooks'],
              message:
                'Call the server from shared/api or a feature api module (features/*/api), not from a component.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.config.{js,ts}', 'eslint.config.js'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  prettier,
);
