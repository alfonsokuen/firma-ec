import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for @firma-ec/pwa E2E tests.
 *
 * - Uses Vite dev server on :5173 (Vite has strictPort, no fallback).
 * - Reuses an already-running dev server when not in CI for fast iteration.
 * - Default project: chromium (Playwright-bundled, isolated from user Chrome).
 * - Mobile project: Pixel 7 (390x844 viewport, touch).
 *
 * Run:
 *   pnpm --filter @firma-ec/pwa exec playwright test
 *   pnpm --filter @firma-ec/pwa exec playwright test --project=mobile
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false, // wizard mutates global state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // svelte-spa-router uses hash routing (#/firmar)
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
    },
  ],

  webServer: {
    command: 'pnpm --filter @firma-ec/pwa dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: '../..',
  },
});
