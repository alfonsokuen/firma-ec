import { defineConfig, devices } from '@playwright/test';

/**
 * Config del e2e del Service Worker — el ÚNICO que corre contra un build real.
 *
 * Por qué existe aparte de `playwright.config.ts`: aquel levanta `vite dev`, y
 * en desarrollo NO hay Service Worker (vite-plugin-pwa solo lo emite en
 * `build`). Por eso 394 tests unitarios y toda la suite e2e daban verde
 * mientras producción se recargaba sola encima del PDF del usuario: nadie
 * probaba nunca con un SW instalándose de verdad.
 *
 * `vite preview` sirve `dist/` tal cual, con su `/sw.js`, que es lo que hace
 * falta para ver el ciclo instalar → `clients.claim()` → `controllerchange`.
 */
/**
 * `SW_E2E_BASE_URL` apunta el mismo spec a un despliegue ya hecho (producción,
 * QA) en vez de levantar el preview local. Es como se comprobó el fallo EN
 * ROJO contra la versión en vivo antes de arreglarlo, y como se verifica cada
 * despliegue después: `SW_E2E_BASE_URL=https://app.firmar.ec pnpm test:e2e:sw`.
 */
const baseExterna = process.env['SW_E2E_BASE_URL'];

export default defineConfig({
  testDir: './tests/sw',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: 1,
  reporter: 'list',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: baseExterna ?? 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(baseExterna
    ? {}
    : {
        webServer: {
          command: 'pnpm --filter @firma-ec/pwa preview --port 4173 --strictPort',
          url: 'http://localhost:4173',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          cwd: '../..',
        },
      }),
});
