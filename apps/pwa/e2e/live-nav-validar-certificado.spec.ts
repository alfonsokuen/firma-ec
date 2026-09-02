/**
 * LIVE regression — el menú "Validar certificado" de la landing debe abrir la
 * HERRAMIENTA (app.firmar.ec/#/validar-certificado), no el artículo SEO
 * (/validar-certificado/).
 *
 * Bug reportado por Leandro el 2026-09-02: desde el menú se llegaba a un texto;
 * para validar de verdad había que volver al inicio, entrar por "Verificar" y
 * desde ahí a la app. Corregido en landing 0.7.2.
 *
 * Vive en `apps/pwa/e2e` porque es el hogar de las specs LIVE del repo (misma
 * `playwright.live.config.ts`); `apps/landing` no tiene @playwright/test y no
 * merece una dependencia nueva solo por esto.
 *
 * Corre contra PRODUCCIÓN: pnpm --filter @firma-ec/pwa exec playwright test \
 *   --config playwright.live.config.ts live-nav-validar-certificado
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_P12 = path.resolve(
  __dirnameLocal,
  '../../../packages/signer/tests/fixtures/rsa2048-valid.p12',
);
const FIXTURE_PIN = 'test1234';
// CN del certificado sintetico (packages/signer/scripts/gen-test-p12.ts).
const FIXTURE_SUBJECT_FRAGMENT = 'Test Signer RSA-2048';

const TOOL_URL = 'https://app.firmar.ec/#/validar-certificado';
const SEO_URL = 'https://firmar.ec/validar-certificado/';

// Por defecto producción. `LANDING_BASE_URL` permite apuntar a un build local
// (p. ej. servir `apps/landing/dist`) para probar ESTA spec en rojo contra una
// versión anterior — un detector que nunca se ha visto fallar no es un detector.
const BASE = (process.env.LANDING_BASE_URL ?? 'https://firmar.ec').replace(/\/$/, '');

const LOCALES = [
  { name: 'ES', url: `${BASE}/`, label: 'Validar certificado' },
  { name: 'EN', url: `${BASE}/en/`, label: 'Validate certificate' },
] as const;

for (const { name, url, label } of LOCALES) {
  test(`${name} · escritorio: el nav "${label}" apunta a la herramienta`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    // El nav de escritorio; el móvil se marca con data-mobile-link.
    const link = page.locator(`header a:not([data-mobile-link])`, { hasText: label }).first();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', TOOL_URL);
  });

  test(`${name} · móvil: el nav "${label}" apunta a la herramienta`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    const link = page.locator('header a[data-mobile-link]', { hasText: label }).first();
    await expect(link).toHaveAttribute('href', TOOL_URL);
  });
}

test('ES · al pulsar el enlace se valida un .p12 de verdad, no se lee un artículo', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(LOCALES[0].url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  await page
    .locator('header a:not([data-mobile-link])', { hasText: LOCALES[0].label })
    .first()
    .click();

  await page.waitForURL(/app\.firmar\.ec\/#\/validar-certificado/, { timeout: 60_000 });

  // La herramienta de verdad, no una pantalla cualquiera de la app: acepta un
  // .p12. El campo de contraseña NO existe hasta que hay archivo cargado
  // (ValidarCertificado.svelte, `{#if pfxBytes}`), así que se pide después.
  const fileInput = page.locator('input[type=file]');
  await expect(fileInput).toHaveCount(1, { timeout: 30_000 });

  // Certificado sintético del repo (autofirmado, PIN conocido). Es seguro
  // contra producción: la validación ocurre ENTERA en el navegador y la llave
  // privada nunca sale del dispositivo — esa es justamente la promesa que se
  // está comprobando.
  await fileInput.setInputFiles(FIXTURE_P12);

  const pin = page.locator('input[type=password]').first();
  await expect(pin).toBeVisible({ timeout: 30_000 });
  await pin.fill(FIXTURE_PIN);
  await pin.press('Enter');

  // Criterio observable: la herramienta EJECUTA y pinta un veredicto con los
  // datos del certificado. Es autofirmado, así que NO encadena a una raíz
  // acreditada; lo que se afirma es que validó, no que el cert sea bueno.
  await expect(page.getByText(FIXTURE_SUBJECT_FRAGMENT, { exact: false }).first()).toBeVisible({
    timeout: 60_000,
  });
});

test('la página SEO sigue publicada (no la rompimos al mover el enlace)', async ({ request }) => {
  const res = await request.get(SEO_URL);
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain('Cómo validar');

  const sitemap = await request.get('https://firmar.ec/sitemap-0.xml');
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).toContain('/validar-certificado/');
});
