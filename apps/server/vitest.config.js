import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/global-setup.js'],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 120_000,
    include: ['test/**/*.test.js'],
  },
});
