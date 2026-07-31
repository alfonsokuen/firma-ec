import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * E2E — /firmar-lote (motor de firma por lotes).
 *
 * Cubre el camino completo con firma REAL: elegir varios PDFs → revisión de
 * colocación previa al PIN → firmar el lote → ZIP descargable. Es la única
 * prueba que ejercita el worker de sesión de verdad; `batchZip.integration`
 * corre contra una sesión falsa, así que un fallo del worker real le pasa
 * inadvertido (fue exactamente lo que ocurrió).
 */
import { type Page, expect, test } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const PDF_A = resolve(HERE, 'fixtures/sample.pdf');
const PDF_B = resolve(REPO_ROOT, 'packages/verifier/tests/fixtures/unsigned.pdf');
/** Ya lleva una firma: obliga al camino de actualización incremental. */
const PDF_SIGNED = resolve(HERE, 'fixtures/sample-b-t.pdf');
const FIXTURE_P12 = resolve(REPO_ROOT, 'packages/signer/tests/fixtures/rsa2048-valid.p12');
const VALID_PIN = 'test1234';

function attachCapture(page: Page): { errors: string[]; logs: string[] } {
  const errors: string[] = [];
  const logs: string[] = [];
  page.on('pageerror', (err) => {
    errors.push(err.message);
    // eslint-disable-next-line no-console
    console.log('[browser:pageerror]', err.message);
  });
  page.on('console', (msg) => {
    const text = msg.text();
    logs.push(text);
    if (/lote-diag|error/i.test(text)) {
      // eslint-disable-next-line no-console
      console.log('[browser:console]', text);
    }
  });
  return { errors, logs };
}

test.describe('firmar.ec — /firmar-lote', () => {
  test('camino completo: 2 PDFs → revisión → firma real → ZIP', async ({ page }) => {
    const cap = attachCapture(page);
    await page.goto('/#/firmar-lote');

    // Paso 1 — elegir los documentos.
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached' });
    await fileInput.setInputFiles([PDF_A, PDF_B]);
    await expect(page.getByText(/2 (de|of) \d+ document/i)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /revisar los 2|review all 2/i }).click();

    // Paso 2 — revisión de colocación (antes del PIN).
    await expect(page.getByRole('heading', { name: /dónde va a quedar tu firma|where your signature will land/i })).toBeVisible({
      timeout: 15_000,
    });
    const continuar = page.getByRole('button', { name: /firmar 2 documentos|sign 2 documents/i });
    await expect(continuar).toBeEnabled({ timeout: 20_000 });
    await continuar.click();

    // Paso 3 — certificado + contraseña.
    await expect(page.getByRole('heading', { name: /tu certificado|your certificate/i })).toBeVisible();
    const p12Input = page.locator('input[type="file"]').first();
    await p12Input.waitFor({ state: 'attached' });
    await p12Input.setInputFiles(FIXTURE_P12);
    const pinInput = page.locator('input[type="password"]').first();
    await pinInput.waitFor({ state: 'visible', timeout: 10_000 });
    await pinInput.fill(VALID_PIN);
    await page.getByRole('button', { name: /firmar los 2|sign all 2/i }).click();

    // Paso 4 — resultado. Lo que importa: que firme de verdad.
    await expect(page.getByRole('link', { name: /descargar zip|download zip/i })).toBeVisible({
      timeout: 120_000,
    });
    await expect(
      page.getByText(
        /quedaron fuera del zip|were left out of the zip|no se firmó ningún documento|no document was signed/i,
      ),
    ).toHaveCount(0);

    expect(cap.errors).toEqual([]);
  });

  test('un PDF ya firmado en el lote se refirma, no se pierde', async ({ page }) => {
    const cap = attachCapture(page);
    await page.goto('/#/firmar-lote');

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached' });
    await fileInput.setInputFiles([PDF_A, PDF_SIGNED]);
    await expect(page.getByText(/2 (de|of) \d+ document/i)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /revisar los 2|review all 2/i }).click();

    await expect(
      page.getByRole('heading', {
        name: /dónde va a quedar tu firma|where your signature will land/i,
      }),
    ).toBeVisible({ timeout: 15_000 });
    const continuar = page.getByRole('button', { name: /firmar 2 documentos|sign 2 documents/i });
    await expect(continuar).toBeEnabled({ timeout: 20_000 });
    await continuar.click();

    await expect(page.getByRole('heading', { name: /tu certificado|your certificate/i })).toBeVisible();
    const p12Input = page.locator('input[type="file"]').first();
    await p12Input.waitFor({ state: 'attached' });
    await p12Input.setInputFiles(FIXTURE_P12);
    const pinInput = page.locator('input[type="password"]').first();
    await pinInput.waitFor({ state: 'visible', timeout: 10_000 });
    await pinInput.fill(VALID_PIN);
    await page.getByRole('button', { name: /firmar los 2|sign all 2/i }).click();

    await expect(page.getByRole('link', { name: /descargar zip|download zip/i })).toBeVisible({
      timeout: 120_000,
    });
    await expect(
      page.getByText(/quedaron fuera del zip|were left out of the zip/i),
    ).toHaveCount(0);

    expect(cap.errors).toEqual([]);
  });
});
