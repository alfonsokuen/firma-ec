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
 * Documento firmado con firma INVISIBLE: `detectSignatures` la cuenta (solo
 * mira `/ByteRange`) pero NO deja widget visible, asi que el anti-solape no
 * tiene nada que esquivar. Medido con pdf.js — la propiedad esta congelada en
 * `src/lib/batch/e2eFixtureProperties.test.ts`: 0 widgets visibles.
 *
 * Dos fixtures DESCARTADAS por medicion, para que nadie las reintente:
 *  - `hash-mismatch.pdf`: 0 widgets visibles y ademas hace declinar al motor,
 *    pero ni pdf.js puede renderizarlo (de ahi su `document_unreadable`), asi
 *    que no llega a haber vista previa que medir.
 *  - `eci-real-contrato2026.pdf`: contando `/Rect` sobre el binario parecia
 *    tener 0 widgets, pero tiene 1 VISIBLE — los objetos van en streams
 *    comprimidos y la regex no los ve. Con ella el anti-solape colocaba caja
 *    igual y este test pasaba con el fix Y sin el: no probaba nada.
 */
const FIXTURE_FIRMA_INVISIBLE = resolve(
  REPO_ROOT,
  'packages/verifier/tests/fixtures/sample-b-b-no-tsa.pdf',
);

/**
 * Fracción de la altura de la página, medida desde el PIE, a la que queda el
 * borde inferior de la caja. 0 = pegada abajo; 1 = pegada arriba.
 *
 * Se mide contra `.box-overlay` y no contra el `<canvas>` porque el overlay ES
 * el área de página que `BoxPlacer` usa para su propio mapeo de coordenadas:
 * mismo elemento, misma escala, sin conversión pt↔px por medio.
 */
async function fraccionesDeLaCaja(
  page: import('@playwright/test').Page,
): Promise<{ y: number; x: number }> {
  const overlay = await page.locator('.box-overlay').boundingBox();
  const caja = await page.locator('.sig-box').boundingBox();
  if (!overlay || !caja) throw new Error('overlay o sig-box sin boundingBox');
  return {
    y: (overlay.y + overlay.height - (caja.y + caja.height)) / overlay.height,
    x: (caja.x - overlay.x) / overlay.width,
  };
}

/**
 * La decision esta tomada cuando el indicador desaparece (`enginePending`
 * vuelve a `false` en el `finally` de `runAutoPlacement`). Esperar por esa
 * senal explicita — en vez de reintentar la medicion con `toPass` — es lo que
 * impide que "primero ensene una caja mala y luego la corregi" cuente como
 * verde: midiendo UNA vez despues de la senal, lo medido es la caja
 * definitiva y la primera a la vez.
 */
async function esperarDecision(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByTestId('auto-searching')).toBeHidden({ timeout: 25_000 });
}

// Los `waitFor` anidados de estos tests suman mas que el timeout por defecto
// en un runner cargado, y el fallo se presentaria como "test timeout" (ruido
// de infra) en vez de como la asercion que de verdad fallo.
test.describe.configure({ timeout: 90_000 });

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
    await esperarDecision(page);

    // Los TRES candidatos, con los numeros congelados del repo sobre esta
    // fixture (612x792 pt — `packages/signer/tests/textBandsPlacement.test.ts`
    // y `BoxPlacer.svelte:165`):
    //   motor             x=18,0  y=69,7   =>  x 0,029 · y 0,088
    //   anti-solape       x=18,0  y=651,7  =>  x 0,029 · y 0,824
    //   default centrado  x=186   y=95,0   =>  x 0,304 · y 0,120
    // Un umbral SOLO en y no basta: 0,088 y 0,120 caen ambos por debajo de
    // 0,25, asi que la version anterior de este test daba verde con el default
    // ciego que esta rama vino justamente a sustituir (QA dual del e2e). Con
    // los dos ejes, el unico candidato que pasa es el motor.
    const { y, x } = await fraccionesDeLaCaja(page);
    expect(y).toBeLessThan(0.11);
    expect(x).toBeLessThan(0.15);
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
    // El contador hace el test autoverificable: si el patron dejara de
    // interceptar (los module workers de Playwright son terreno irregular),
    // el retraso no se aplicaria, el orden no se invertiria y el test pasaria
    // sin haber ejercitado NUNCA la carrera que lo justifica.
    let interceptado = 0;
    await page.route('**/preflight.worker*', async (route) => {
      interceptado += 1;
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
    const { y, x } = await fraccionesDeLaCaja(page);
    expect(y).toBeLessThan(0.11);
    expect(x).toBeLessThan(0.15);
    expect(
      interceptado,
      'el retraso del worker no se aplico: este test no probo la carrera',
    ).toBeGreaterThan(0);
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
    //
    // La premisa "el motor declina AQUI" vivia congelada en otro fichero
    // (`textBandsPlacement.test.ts`: 'REVIEW p0 no_free_slot') sin nada que
    // enlazara los dos: si el motor dejara de declinar en esta fixture, el
    // test pasaria a verde VACIO. Se asserta desde aqui leyendo el codigo que
    // el propio producto emite al declinar.
    const declinaciones: string[] = [];
    page.on('console', (m) => {
      if (m.text().includes('auto-placement declined')) declinaciones.push(m.text());
    });

    await page.goto('/#/firmar');
    const pdfInput = page.locator('input[type="file"]').first();
    await pdfInput.waitFor({ state: 'attached' });
    await pdfInput.setInputFiles(FIXTURE_MOTOR_DECLINA);

    await page.locator('.box-overlay').waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('.sig-box').waitFor({ state: 'visible', timeout: 15_000 });
    await esperarDecision(page);

    const { x } = await fraccionesDeLaCaja(page);
    expect(x).toBeLessThan(0.15);
    expect(
      declinaciones.join(' | '),
      'la fixture dejo de hacer declinar al motor: este test ya no prueba el fallback',
    ).toContain('no_free_slot');
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

  test('con firma previa INVISIBLE y el motor caido, sigue habiendo caja', async ({ page }) => {
    // Regresion HIGH del QA dual del e2e, contra `main`. La cadena:
    //   1. `sample-b-b-no-tsa.pdf` trae 1 firma sin widget visible
    //      (medido con pdf.js, congelado en `e2eFixtureProperties.test.ts`), y
    //      `detectSignatures` la cuenta igual porque solo mira `/ByteRange`
    //      => `autoPlaceDefault = false` al soltar el PDF.
    //   2. El escaneo de widgets de pdf.js llega ANTES que el motor => se
    //      guarda en `pendingScan` y se sale sin tocar el default. Ese orden
    //      es el que fuerza el retraso del worker de abajo.
    //   3. El motor cae => `applySmartFallback()` => `computeSmartPlacement`
    //      devuelve null porque no hay widget visible que esquivar
    //      (smartPlacement.ts:153) => `boxPos` sigue null.
    //   4. El gate del `finally` da false, y `scanSignatureWidgets` ya no
    //      vuelve a correr (una vez por carga) => paso 2 SIN NINGUNA CAJA,
    //      para siempre. En `main` aparecia el default centrado.
    //
    // La caida del motor se provoca abortando su chunk: es el escenario de
    // produccion mas grave (un deploy rompe el worker y degrada a TODOS los
    // usuarios al camino ciego), no un caso de laboratorio.
    //
    // 🔑 El `route` se instala AQUI, con la app YA montada, y no al principio
    // del test: el patron tambien casa durante la carga del grafo de modulos,
    // y entonces el retraso agota el arranque y el test muere esperando el
    // `input[type=file]` en vez de en su asercion (medido: asi fallaba tanto
    // este test como el de la carrera al correrlos con el server frio). Puesto
    // despues, solo intercepta la peticion que dispara el propio drop.
    //
    // El retraso previo al abort es lo que garantiza el orden del paso 2: da
    // tiempo a que el escaneo de widgets de pdf.js aterrice primero.
    await page.goto('/#/firmar');
    const pdfInput = page.locator('input[type="file"]').first();
    await pdfInput.waitFor({ state: 'attached' });

    let interceptado = 0;
    await page.route('**/preflight.worker*', async (route) => {
      interceptado += 1;
      await new Promise((r) => setTimeout(r, 2500));
      await route.abort();
    });

    await pdfInput.setInputFiles(FIXTURE_FIRMA_INVISIBLE);

    // Premisa del paso 2, asertada y no supuesta: con la vista previa ya
    // pintada (=> el escaneo de widgets ya corrio) el motor SIGUE pendiente.
    await page.locator('.box-overlay').waitFor({ state: 'visible', timeout: 20_000 });
    await expect(page.getByTestId('auto-searching')).toBeVisible();

    await esperarDecision(page);
    await expect(
      page.locator('.sig-box'),
      'sin caja en el paso 2: no queda forma automatica de colocar la firma',
    ).toBeVisible({ timeout: 15_000 });
    expect(interceptado, 'el worker no fue interceptado: el motor no cayo').toBeGreaterThan(0);
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
