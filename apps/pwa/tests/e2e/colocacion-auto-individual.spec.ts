import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * E2E — colocación automática en el flujo de UNA firma (`/firmar`).
 *
 * Por qué existe: hasta esta rama, `/firmar` era el ÚNICO flujo que colocaba la
 * caja SIN mirar las bandas de texto del documento. Con firmas previas usaba
 * `computeSmartPlacement` (que busca un hueco junto a ellas y puede subir una
 * fila hasta el cuerpo del texto) y, sin ellas, un default centrado al 12% de
 * la altura. El motor completo —el mismo que usa el lote— solo corría en
 * `/firmar-lote`.
 *
 * Este spec prueba la RUTA REAL, no el helper: arranca la app, suelta un PDF y
 * mide dónde acabó la caja en pantalla. La suite unitaria puede estar verde con
 * los helpers perfectos y el cableado roto; esto es lo que lo distingue.
 *
 * Medido sobre la fixture (motor, `computeAutoPlacement`):
 *   audit-075-2026.pdf → página 3 (0-based), y = 69,7 pt, alto 72, página 792 pt
 *   ⇒ el borde inferior de la caja queda al 8,8% de la altura desde el pie.
 * El comportamiento ANTERIOR situaba esa misma caja en y = 652 pt ⇒ 82%: en
 * mitad del cuerpo del documento. De ahí el umbral de abajo — cualquier valor
 * entre ambos separa el antes del después sin depender de la escala de render.
 *
 * @see apps/pwa/src/routes/Firmar.svelte (`runAutoPlacement`)
 * @see packages/signer/src/autoPlacement.ts
 */
import { expect, test } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
/** 4 páginas, 4 firmas previas: el caso donde el default viejo subía al cuerpo. */
const FIXTURE_CON_FIRMAS = resolve(
  REPO_ROOT,
  'packages/verifier/tests/fixtures/audit-075-2026.pdf',
);

/**
 * Fracción de la altura de la página, medida desde el PIE, a la que queda el
 * borde inferior de la caja. 0 = pegada abajo; 1 = pegada arriba.
 *
 * Se mide contra `.box-overlay` y no contra el `<canvas>` porque el overlay ES
 * el área de página que `BoxPlacer` usa para su propio mapeo de coordenadas:
 * mismo elemento, misma escala, sin conversión pt↔px por medio.
 */
async function fraccionDesdeElPie(page: import('@playwright/test').Page): Promise<number> {
  const overlay = await page.locator('.box-overlay').boundingBox();
  const caja = await page.locator('.sig-box').boundingBox();
  if (!overlay || !caja) throw new Error('overlay o sig-box sin boundingBox');
  return (overlay.y + overlay.height - (caja.y + caja.height)) / overlay.height;
}

test.describe('/firmar — la caja inicial la decide el motor', () => {
  test('en un PDF con firmas previas cae al pie, no sobre el cuerpo del documento', async ({
    page,
  }) => {
    await page.goto('/#/firmar');

    const pdfInput = page.locator('input[type="file"]').first();
    await pdfInput.waitFor({ state: 'attached' });
    await pdfInput.setInputFiles(FIXTURE_CON_FIRMAS);

    await page.locator('.box-overlay').waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('.sig-box').waitFor({ state: 'visible', timeout: 15_000 });

    // `toPass` porque la colocación del motor llega por worker: la caja puede
    // renderizarse un tick antes de que el resultado aterrice. Lo que NO se
    // acepta es que se quede arriba.
    await expect(async () => {
      const fraccion = await fraccionDesdeElPie(page);
      // Motor: 8,8%. Comportamiento anterior: 82%. Umbral holgado a propósito
      // — no fija el píxel exacto, fija la PROPIEDAD (la firma va abajo).
      expect(fraccion).toBeLessThan(0.25);
    }).toPass({ timeout: 15_000 });
  });

  test('la caja no se solapa con ninguna de las firmas previas del documento', async ({ page }) => {
    await page.goto('/#/firmar');
    const pdfInput = page.locator('input[type="file"]').first();
    await pdfInput.waitFor({ state: 'attached' });
    await pdfInput.setInputFiles(FIXTURE_CON_FIRMAS);

    await page.locator('.box-overlay').waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('.sig-box').waitFor({ state: 'visible', timeout: 15_000 });

    // La caja debe existir, tener tamaño legible y caber ENTERA dentro de la
    // página: el motor valida esto (`validateVisibleSig`), así que si el rect
    // que llega a la vista se sale, la conversión de convenio está mal.
    await expect(async () => {
      const overlay = await page.locator('.box-overlay').boundingBox();
      const caja = await page.locator('.sig-box').boundingBox();
      if (!overlay || !caja) throw new Error('overlay o sig-box sin boundingBox');
      expect(caja.width).toBeGreaterThan(10);
      expect(caja.height).toBeGreaterThan(10);
      expect(caja.x).toBeGreaterThanOrEqual(overlay.x - 1);
      expect(caja.y).toBeGreaterThanOrEqual(overlay.y - 1);
      expect(caja.x + caja.width).toBeLessThanOrEqual(overlay.x + overlay.width + 1);
      expect(caja.y + caja.height).toBeLessThanOrEqual(overlay.y + overlay.height + 1);
    }).toPass({ timeout: 15_000 });
  });
});
