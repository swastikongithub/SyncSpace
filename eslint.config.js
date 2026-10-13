import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'playwright-report/**', 'test-results/**', 'measurements/raw/**', '.claude/**', '.agents/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['apps/server/**/*.js', 'apps/*/scripts/**/*.js', 'packages/**/*.js', 'scripts/**/*.{js,mjs}', 'e2e/**/*.js', '*.config.js', 'apps/*/*.config.js', 'docker/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // e2e specs (and the landing measurement) pass callbacks to page.evaluate(), which run in the browser.
    files: ['packages/sync-client/**/*.js', 'packages/shared/**/*.js', 'e2e/**/*.js', 'scripts/measure-landing.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['apps/web/**/*.{js,jsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // mongosh init scripts run with the shell's globals.
    files: ['docker/mongo/**/*.js'],
    languageOptions: { globals: { db: 'readonly', print: 'readonly', process: 'readonly' } },
  },
];
