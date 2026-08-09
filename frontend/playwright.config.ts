import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  retries: 2,
  expect: {
    timeout: 10000,
  },
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
    strictSelectors: true,
  },
});
