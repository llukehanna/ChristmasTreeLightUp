import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  // The real Worker (wrangler dev) over the production build, a fresh local D1 and R2, and fake sign-in (localhost only).
  webServer: {
    command: 'npm run build && npm run serve:e2e',
    url: 'http://localhost:4173',
    // Never reuse a stale server: the tests need a fresh local D1 and the current build.
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
});
