import { defineConfig, devices } from '@playwright/test';

// Config propio del canary de navegación (patrón de `playwright.live-install.config.ts`).
// `testMatch` acotado POR NOMBRE: el config compartido `playwright.live.config.ts` casa
// cualquier `*.spec.ts` de su carpeta y arrastraba también la auditoría v0.3.3, rancia.
// Sin webServer: habla directamente con producción.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /nav-validar-certificado\.live\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // NO se ignoran errores de TLS: un certificado roto en prod debe enrojecer
    // este canary, no pasar desapercibido (el config compartido sí los ignora).
    ignoreHTTPSErrors: false,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
