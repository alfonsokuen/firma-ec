import { defineConfig, devices } from '@playwright/test';

/**
 * Config para la verificación EN VIVO del embudo de instalación contra
 * `app.firmar.ec`. Sin `webServer` y sin `baseURL`: los tests usan URLs
 * absolutas de producción a propósito.
 *
 * No forma parte del gate de PR — se corre a mano después de un deploy.
 * `playwright.live.config.ts` (v0.3.3) apunta a `./e2e`, que ya no es donde
 * viven los tests; este apunta a `./tests/e2e` y solo recoge el spec live.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /install-funnel\.live\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Producción no se reintenta: un verde por reintento esconde intermitencia.
  retries: 0,
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
