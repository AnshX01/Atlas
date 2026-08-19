import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  retries: 2,
  expect: {
    timeout: 10000,
  },
  reporter: 'list',
  webServer: {
    command: 'npm run dev -- -p 3001',
    port: 3001,
    reuseExistingServer: true,
  },
  use: {
    trace: 'on-first-retry',
    strictSelectors: true,
  },
});
