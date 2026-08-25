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
/** 1 página, firma previa visible y sin hueco libre: el motor DECLINA (no_free_slot). */
const FIXTURE_MOTOR_DECLINA = resolve(
  REPO_ROOT,
  'packages/verifier/tests/fixtures/carta-arrendamiento-firmado.pdf',
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

  test('el motor gana aunque el escaneo de widgets termine primero (worker retrasado)', async ({
    page,
  }) => {
    // Simula el dispositivo lento: el script del worker de análisis tarda
    // 1,5 s en llegar, así que el escaneo de widgets de pdf.js termina ANTES.
    // Sin el gate `enginePending`, `computeSmartPlacement` colocaba primero
    // (y=652 sobre 792 pt en esta fixture, fracción ≈0,82 — el cuerpo del
    // documento) y el resultado del motor, al llegar segundo, se descartaba
    // en silencio: la colocación dependía de una CARRERA. Verificado en ROJO
    // contra el código sin gate antes de dar el verde por bueno.
    await page.route('**/preflight.worker*', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });

    await page.goto('/#/firmar');
    const pdfInput = page.locator('input[type="file"]').first();
    await pdfInput.waitFor({ state: 'attached' });
    await pdfInput.setInputFiles(FIXTURE_CON_FIRMAS);

    await page.locator('.box-overlay').waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('.sig-box').waitFor({ state: 'visible', timeout: 15_000 });

    // Medición ÚNICA e inmediata, sin reintentos: la propiedad es que la
    // PRIMERA caja que aparece sea la del motor — en el modo guiado la
    // primera que aparece es la que se confirma, así que un "estado final
    // correcto" tras enseñar una caja mala no vale.
    const fraccion = await fraccionDesdeElPie(page);
    expect(fraccion).toBeLessThan(0.25);
  });

  test('si el motor declina, el anti-solape de siempre coloca junto a la firma previa', async ({
    page,
  }) => {
    // carta-arrendamiento-firmado.pdf: 1 página con firma previa VISIBLE y sin
    // hueco libre — el motor devuelve `needs_review` (medido: no_free_slot).
    //
    // Qué fija este test — y qué NO: fija la PROPIEDAD del fallback (motor
    // declina ⇒ la caja acaba junto a la firma previa por anti-solape,
    // x = 18 pt ≈ 0,03 del ancho, no centrada a ≈ 0,30). NO puede ejercitar
    // la regresión del gate del `finally` (QA dual 2026-08-25): el rival del
    // anti-solape es el default centrado de BoxPlacer, que solo existe tras
    // `pageInfo` — es decir, TAMBIÉN detrás de pdf.js — así que ningún
    // retraso de red cambia su orden relativo, y la microcarrera efecto-vs-
    // callback no es controlable desde un e2e de caja negra. Esa regresión
    // queda cubierta por el diseño determinista (gate `enginePending` +
    // reactivación condicionada) y por revisión, no por este test.
    await page.goto('/#/firmar');
    const pdfInput = page.locator('input[type="file"]').first();
    await pdfInput.waitFor({ state: 'attached' });
    await pdfInput.setInputFiles(FIXTURE_MOTOR_DECLINA);

    await page.locator('.box-overlay').waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('.sig-box').waitFor({ state: 'visible', timeout: 15_000 });

    await expect(async () => {
      const overlay = await page.locator('.box-overlay').boundingBox();
      const caja = await page.locator('.sig-box').boundingBox();
      if (!overlay || !caja) throw new Error('overlay o sig-box sin boundingBox');
      const fraccionX = (caja.x - overlay.x) / overlay.width;
      expect(fraccionX).toBeLessThan(0.15);
    }).toPass({ timeout: 15_000 });
  });

  test('modo guiado: con PDF firmado y motor que declina, hay sugerencia y el CTA se habilita', async ({
    page,
  }) => {
    // Regresión del QA dual (HIGH, reproducida): el gate del `finally`
    // esperaba a `onSignaturesScanned`, que en GUIADO no está cableado —
    // SimplePlacer usa su propio escaneo. Con documento firmado + motor que
    // declina (carta-arrendamiento: no_free_slot), `autoPlaceDefault` se
    // quedaba en false para siempre: cero `.placed-box` y "Sí, continuar"
    // deshabilitado. El control en verde del caso limpio ya existe (golden
    // path de firmar-facil.spec.ts con sample.pdf).
    await page.goto('/#/firmar-facil');
    // Puerta de bienvenida del guiado: "Empezar" desbloquea el Drop.
    await page.getByRole('button', { name: /^empezar$|^start$/i }).click();

    const pdfInput = page.locator('input[type="file"]').first();
    await pdfInput.waitFor({ state: 'attached' });
    await pdfInput.setInputFiles(FIXTURE_MOTOR_DECLINA);

    // La sugerencia propia del guiado debe aparecer (anti-solape local de
    // placeAtBottomLastPage) y el CTA habilitarse.
    await page.locator('.placed-box').waitFor({ state: 'visible', timeout: 15_000 });
    const cta = page.getByRole('button', { name: /sí, continuar|yes, continue/i });
    await expect(cta).toBeEnabled({ timeout: 5_000 });
  });

  test('la caja cae entera dentro de la página, con tamaño legible (conversión de convenio)', async ({
    page,
  }) => {
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
