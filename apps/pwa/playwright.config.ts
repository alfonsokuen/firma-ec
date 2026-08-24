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
  // _capture-tutorial.spec.ts is a throwaway capture script for an unrelated
  // task (firmar.ec tutorial reel): it targets the LIVE prod app
  // (https://app.firmar.ec) over the network and documents itself as "not
  // part of the regular suite — run directly, then delete". Excluded here so
  // the default `playwright test` run stays hermetic (local dev server only)
  // and deterministic in CI/offline environments.
  // Los `*.live.spec.ts` afirman el estado de PRODUCCION, no el del arbol:
  // solo pueden pasar DESPUES de desplegar. Si los ejecuta el gate del PR se
  // vuelven un bloqueo circular — el PR que traeria el cambio a produccion no
  // puede mergearse porque produccion aun no lo tiene. Se corren a mano con
  // `playwright.live-install.config.ts` una vez desplegado.
  testIgnore: ['**/_capture-tutorial.spec.ts', '**/*.live.spec.ts'],
  // Generates the ephemeral self-signed .p12 fixture used by spike-sign.spec.ts
  // (and future real-signing e2e coverage) before any test file runs.
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false, // wizard mutates global state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'list',
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
    // E2E_MOCK_TSA=1 activates the dev-only `/api/tsa` mock middleware (see
    // vite.config.ts `e2eMockTsa`) consumed by tests/e2e/tsa-flow.spec.ts.
    // No-op for every other spec; zero effect on `vite build`.
    // DEV_FS_ALLOW_PEM=1 relaxes Vite's default `fs.deny` (`*.{crt,pem}`)
    // just for this dev server, so the real-signing golden-path specs
    // (firma.spec.ts, firmar-facil.spec.ts, tsa-flow.spec.ts) can load the
    // TSL trust-anchor `.pem?raw` imports — see vite.config.ts `server.fs`
    // for the full root-cause writeup and trade-off.
    env: { ...process.env, E2E_MOCK_TSA: '1', E2E_MOCK_AIA: '1', DEV_FS_ALLOW_PEM: '1' },
  },
});
