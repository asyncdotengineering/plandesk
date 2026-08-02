import { defineConfig, devices } from '@playwright/test';

/**
 * Chromium-only browser harness for the prototype frame contract.
 * Specs live under browser-tests/ so vitest run never picks them up.
 */
export default defineConfig({
  testDir: './browser-tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
