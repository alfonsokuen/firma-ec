import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * E2E — /firmar-lote, colocador manual de un documento `needs_review` (F1
 * fase B).
 *
 * Antes de esta fase, un documento que el pre-vuelo marcaba `needs_review`
 * solo podía QUITARSE del lote (`removeFromReview`) — no había forma de
 * colocar la firma a mano sin salir del flujo del lote. Esta prueba cubre el
 * camino nuevo: un documento sin sitio automático entra a la sub-vista de
 * colocación, la persona confirma un rect, y ESE documento firma junto con el
 * resto en el mismo ZIP.
 *
 * El PDF que sale `needs_review` se genera en caliente
 * (`../../src/lib/batch/noFreeSlotPdf.ts`) — texto denso margen a margen, sin
 * hueco para la estampa de 240×72pt. Un unit test aparte
 * (`src/lib/batch/noFreeSlotPdf.test.ts`) ya verifica contra el pipeline REAL
 * que este fixture produce `needs_review`/`no_free_slot`; si algún día dejara
 * de hacerlo, ese test lo dice en segundos, no este e2e con un timeout mudo.
 */
import { type Page, expect, test } from '@playwright/test';
import { buildNoFreeSlotPdf } from '../../src/lib/batch/noFreeSlotPdf';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const NORMAL_PDF = resolve(HERE, 'fixtures/sample.pdf');
const FIXTURE_P12 = resolve(REPO_ROOT, 'packages/signer/tests/fixtures/rsa2048-valid.p12');
const VALID_PIN = 'test1234';

function attachCapture(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on('pageerror', (err) => {
    errors.push(err.message);
    // eslint-disable-next-line no-console
    console.log('[browser:pageerror]', err.message);
  });
  return { errors };
}

test.describe('firmar.ec — /firmar-lote — colocador manual', () => {
  test('un documento needs_review se coloca a mano y firma junto con el resto', async ({
    page,
  }) => {
    const cap = attachCapture(page);
    const tmpDir = mkdtempSync(join(tmpdir(), 'fec-lote-colocador-manual-'));
    const noFreeSlotPath = join(tmpDir, 'no-free-slot.pdf');
    try {
      writeFileSync(noFreeSlotPath, await buildNoFreeSlotPdf());

      await page.goto('/#/firmar-lote');

      // Paso 1 — un documento normal (sale `ready`) + el adversarial (sale
      // `needs_review`).
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.waitFor({ state: 'attached' });
      await fileInput.setInputFiles([noFreeSlotPath, NORMAL_PDF]);
      await expect(page.getByText(/2 (de|of) \d+ document/i)).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: /revisar los 2|review all 2/i }).click();

      // Paso 2 — revisión: la fila needs_review trae la acción de colocar a mano.
      await expect(
        page.getByRole('heading', {
          name: /dónde va a quedar tu firma|where your signature will land/i,
        }),
      ).toBeVisible({ timeout: 15_000 });

      const placeByHand = page.getByRole('button', {
        name: /firmar este a mano|sign this one by hand/i,
      });
      await expect(placeByHand).toBeVisible({ timeout: 20_000 });
      // El único documento firmable automáticamente es el normal; el
      // adversarial de verdad cayó a needs_review (no un `ready` disfrazado).
      await expect(
        page.getByRole('button', { name: /firmar 1 documento|sign 1 document/i }),
      ).toBeVisible();

      await placeByHand.click();

      // Sub-vista del colocador manual.
      await expect(
        page.getByRole('heading', { name: /coloca la firma|place the signature/i }),
      ).toBeVisible({ timeout: 10_000 });
      await page.locator('.box-overlay').waitFor({ state: 'visible', timeout: 15_000 });
      await page.locator('.sig-box').waitFor({ state: 'visible', timeout: 10_000 });

      const confirmBtn = page.getByRole('button', {
        name: /confirmar colocación|confirm placement/i,
      });
      await expect(confirmBtn).toBeEnabled({ timeout: 10_000 });
      await confirmBtn.click();

      // De vuelta en la revisión: la fila ahora es `ready` / "Colocada a mano".
      await expect(page.getByText(/colocada a mano|placed by hand/i)).toBeVisible({
        timeout: 10_000,
      });
      const continuar = page.getByRole('button', { name: /firmar 2 documentos|sign 2 documents/i });
      await expect(continuar).toBeEnabled({ timeout: 10_000 });
      await continuar.click();

      // Paso 3 — certificado + PIN (mismo patrón que firmar-lote.spec.ts).
      await expect(
        page.getByRole('heading', { name: /tu certificado|your certificate/i }),
      ).toBeVisible();
      const p12Input = page.locator('input[type="file"]').first();
      await p12Input.waitFor({ state: 'attached' });
      await p12Input.setInputFiles(FIXTURE_P12);
      const pinInput = page.locator('input[type="password"]').first();
      await pinInput.waitFor({ state: 'visible', timeout: 10_000 });
      await pinInput.fill(VALID_PIN);
      await page.getByRole('button', { name: /firmar los 2|sign all 2/i }).click();

      // Paso 4 — resultado: los DOS documentos, incluido el colocado a mano,
      // llegan al ZIP.
      await expect(page.getByRole('link', { name: /descargar zip|download zip/i })).toBeVisible({
        timeout: 120_000,
      });
      await expect(
        page.getByText(
          /quedaron fuera del zip|were left out of the zip|no se firmó ningún documento|no document was signed/i,
        ),
      ).toHaveCount(0);

      expect(cap.errors).toEqual([]);
    } finally {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
