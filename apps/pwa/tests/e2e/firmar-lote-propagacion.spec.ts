import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * E2E — /firmar-lote, propagación de la colocación manual (F2c).
 *
 * F2a (motor) y F2b (`propagation.ts`/`preflight.ts` hint plumbing) eran
 * inertes a propósito: nadie los llamaba todavía. Esta es la fase que
 * enciende la feature en la UI real de `FirmarLote.svelte` —
 * `commitPlacement` ahora dispara `propagateFrom`, que re-analiza los demás
 * `needs_review` con la MISMA firma de formato usando la posición recién
 * confirmada como hint.
 *
 * ## Por qué este fixture NO es `noFreeSlotPdf.ts` (F1)
 *
 * El plan original pedía reusar `noFreeSlotPdf.ts` (texto denso margen a
 * margen) para AMBOS documentos. Se intentó: produce `needs_review` en los
 * dos, pero la propagación JAMÁS puede resolverlos a `ready`, por diseño de
 * ese fixture — no hay NINGÚN hueco de 240×72pt en toda la página (esa es
 * exactamente su garantía, ver el comentario de ese archivo), y
 * `tryAnchorPlacement` (la ruta que el hint activa, `autoPlacement.ts` fuente
 * 1.5) sigue exigiendo un hueco real del mismo tamaño de caja: un hint no
 * puede inventar espacio donde no lo hay. Confirmado empíricamente: con ese
 * fixture, el segundo documento queda `needs_review` incluso después de
 * propagar.
 *
 * Este fixture (`buildNarrowGapPdf`) deja un hueco real de 80pt (entre
 * y=350 y y=430) — insuficiente para la caja POR DEFECTO (240×72pt, que
 * exige ~86pt de holgura con el margen de separación) pero suficiente para
 * una caja ENCOGIDA a 56pt de alto (mínimo permitido por `BoxPlacer`,
 * `MIN_H=54`). Por eso el test ENCOGE la caja con el handle de resize antes
 * de confirmar: es, con el motor real, la única vía honesta para que
 * `computeAutoPlacement` decida distinto CON hint que SIN él (ver
 * `propagation.ts`: "el tamaño de caja que la persona confirmó — nunca el
 * default"), y a la vez la única forma de reproducir E2E el ÚNICO camino real
 * (fuente 1.5, `tryAnchorPlacement`) por el que un hint puede convertir un
 * `needs_review` en `ready` en el motor actual. Se validó primero contra el
 * pipeline real (`analyzeForPreflight`) antes de escribir la interacción de
 * UI, para no adivinar a ciegas contra el navegador.
 *
 * Caso (b) del plan — un segundo documento que, pese al hint, sigue
 * `needs_review` porque el sitio propuesto también está ocupado ahí — queda
 * documentado como PENDIENTE: requeriría un tercer fixture cuyo único hueco
 * NO coincida con el que el hint pide, construido con la misma precisión
 * quirúrgica que este (hueco real, mismo tamaño de caja encogida, verificado
 * primero contra `analyzeForPreflight`). No se fuerza aquí por presupuesto de
 * tiempo — ver también los ~20 tests unitarios de
 * `preflight-core.parity.test.ts` que ya cubren `'moved'`/rechazo de hint a
 * nivel de motor.
 */
import { type Page, expect, test } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { buildNoFreeSlotPdf } from '../../src/lib/batch/noFreeSlotPdf';
import { buildHeavyPreflightPdf } from './helpers/heavy-preflight-pdf';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const FIXTURE_P12 = resolve(REPO_ROOT, 'packages/signer/tests/fixtures/rsa2048-valid.p12');
const VALID_PIN = 'test1234';

const PAGE_W = 612;
const PAGE_H = 792;
const LINE_PITCH_PT = 8;
const TOP_MARGIN_PT = 12;
const BOTTOM_MARGIN_PT = 12;
/** El único hueco de la página: 80pt, entre estos dos límites (ver
 *  cabecera del archivo — insuficiente para la caja por defecto, suficiente
 *  para la encogida a 56pt que el test confirma). */
const GAP_BOTTOM_PT = 350;
const GAP_TOP_PT = 430;
/** Altura de caja encogida que el test confirma en el colocador manual —
 *  por encima de `MIN_H` (54pt) de `BoxPlacer.svelte`, cabe en el hueco. */
const SHRUNK_BOX_H_PT = 56;
/** Punto medio del hueco utilizable tras la caja encogida (ver cabecera):
 *  ventana válida ≈ [357, 367] en `y` canónico; 362 deja margen a ambos lados. */
const TARGET_BOX_BOTTOM_Y_PT = 362;
const DEFAULT_BOX_W_PT = 240;
/** `placeAtBottomLastPage` (sin firmas previas) ancla la caja por defecto al
 *  pie de página: y=18 (EDGE_MARGIN), tal como confirmado corriendo este
 *  mismo fixture contra la UI real antes de fijar esta constante. */
const DEFAULT_BOX_BOTTOM_Y_PT = 18;

/**
 * Página US-Letter con texto denso margen a margen EXCEPTO un hueco real de
 * `GAP_BOTTOM_PT`–`GAP_TOP_PT` — mismo mecanismo que `noFreeSlotPdf.ts` (F1):
 * una línea cada `LINE_PITCH_PT` se funde en una sola banda de texto que
 * `autoPlacement.ts` trata como obstáculo a lo ancho de toda la página
 * visible (ver `textBandRects`). Al saltarse las líneas dentro del hueco, esa
 * franja queda genuinamente libre — no es una banda angosta, es la ÚNICA
 * región sin texto de la página entera.
 */
async function buildNarrowGapPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const lines: string[] = [];
  for (let y = BOTTOM_MARGIN_PT; y <= PAGE_H - TOP_MARGIN_PT; y += LINE_PITCH_PT) {
    if (y > GAP_BOTTOM_PT && y < GAP_TOP_PT) continue;
    lines.push(
      `BT /F1 7 Tf 1 0 0 1 40 ${y} Tm (clausula de relleno sin espacio para la estampa) Tj ET`,
    );
  }
  const content = lines.join('\n');
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(content)));
  return doc.save();
}

function attachCapture(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on('pageerror', (err) => {
    errors.push(err.message);
    // eslint-disable-next-line no-console
    console.log('[browser:pageerror]', err.message);
  });
  return { errors };
}

test.describe('firmar.ec — /firmar-lote — propagación de colocación', () => {
  test('colocar el primero a mano (caja encogida al único hueco real) propaga al segundo', async ({
    page,
  }) => {
    const cap = attachCapture(page);
    const tmpDir = mkdtempSync(join(tmpdir(), 'fec-lote-propagacion-'));
    const pathA = join(tmpDir, 'narrow-gap-a.pdf');
    const pathB = join(tmpDir, 'narrow-gap-b.pdf');
    try {
      // Misma función, dos llamadas: mismo layout, mismo hueco, misma firma
      // de geometría — la condición que `propagationCandidates` exige.
      writeFileSync(pathA, await buildNarrowGapPdf());
      writeFileSync(pathB, await buildNarrowGapPdf());

      await page.goto('/#/firmar-lote');

      // Paso 1 — dos copias del PDF con el hueco angosto.
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.waitFor({ state: 'attached' });
      await fileInput.setInputFiles([pathA, pathB]);
      await expect(page.getByText(/2 (de|of) \d+ document/i)).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: /revisar los 2|review all 2/i }).click();

      // Paso 2 — revisión: AMBOS documentos salen needs_review (la caja por
      // defecto de 240×72pt no cabe en el hueco de 80pt).
      await expect(
        page.getByRole('heading', {
          name: /dónde va a quedar tu firma|where your signature will land/i,
        }),
      ).toBeVisible({ timeout: 15_000 });

      const placeByHand = page.getByRole('button', {
        name: /firmar este a mano|sign this one by hand/i,
      });
      await expect(placeByHand.first()).toBeVisible({ timeout: 20_000 });
      await expect(placeByHand).toHaveCount(2);

      // Coloca el PRIMERO a mano.
      await placeByHand.first().click();

      await expect(
        page.getByRole('heading', { name: /coloca la firma|place the signature/i }),
      ).toBeVisible({ timeout: 10_000 });
      await page.locator('.box-overlay').waitFor({ state: 'visible', timeout: 15_000 });
      const sigBoxLocator = page.locator('.sig-box');
      await sigBoxLocator.waitFor({ state: 'visible', timeout: 10_000 });
      // El wizard es más alto que el viewport por defecto: sin esto, la caja
      // (y el handle) caen fuera del área visible y `document.elementFromPoint`
      // en esas coordenadas devuelve null — el mouse "clickea" el vacío.
      await sigBoxLocator.scrollIntoViewIfNeeded();

      // Escala CSS-px por pt derivada de la caja por defecto ya renderizada
      // (240×72pt) — más fiable que medir el <canvas> por separado: es
      // EXACTAMENTE la misma escala que `BoxPlacer` usa para sus propios
      // cálculos de drag/resize, tomada del mismo elemento que se va a
      // arrastrar.
      const initialBox = await sigBoxLocator.boundingBox();
      if (!initialBox) throw new Error('sig-box sin boundingBox');
      const scale = initialBox.width / DEFAULT_BOX_W_PT;

      // 1) Encoger la caja al alto mínimo permitido con margen para el
      // hueco: arrastrar el handle de resize (esquina inferior-derecha)
      // manteniendo el ANCHO igual (no se toca la coordenada X del handle) y
      // llevando la altura a SHRUNK_BOX_H_PT.
      const handleLocator = page.locator('.sig-handle');
      const handleBox = await handleLocator.boundingBox();
      if (!handleBox) throw new Error('sig-handle sin boundingBox');
      const handleCenterX = handleBox.x + handleBox.width / 2;
      const handleCenterY = handleBox.y + handleBox.height / 2;
      const targetHandleY = initialBox.y + SHRUNK_BOX_H_PT * scale;

      await page.mouse.move(handleCenterX, handleCenterY, { steps: 3 });
      await page.mouse.down();
      await page.mouse.move(handleCenterX, targetHandleY, { steps: 10 });
      await page.mouse.up();

      // La caja debe reflejar la nueva altura antes de seguir.
      await expect(async () => {
        const resized = await sigBoxLocator.boundingBox();
        expect(resized?.height).toBeGreaterThan(SHRUNK_BOX_H_PT * scale - 3);
        expect(resized?.height).toBeLessThan(SHRUNK_BOX_H_PT * scale + 3);
      }).toPass({ timeout: 5_000 });

      // 2) Arrastrar la caja (ya encogida) desde el pie de página (y=18pt,
      // donde cae por defecto) hasta el centro del hueco real
      // (TARGET_BOX_BOTTOM_Y_PT). Se agarra por el CENTRO de la caja para no
      // tocar el handle, y como el ancho no cambia, basta mover en VERTICAL:
      // subir (TARGET − DEFAULT_BOX_BOTTOM_Y_PT) puntos, convertidos a CSS-px.
      const resizedBox = await sigBoxLocator.boundingBox();
      if (!resizedBox) throw new Error('sig-box sin boundingBox tras resize');
      const grabX = resizedBox.x + resizedBox.width / 2;
      const grabY = resizedBox.y + resizedBox.height / 2;
      const deltaPt = TARGET_BOX_BOTTOM_Y_PT - DEFAULT_BOX_BOTTOM_Y_PT;
      const targetGrabY = grabY - deltaPt * scale;

      await page.mouse.move(grabX, grabY);
      await page.mouse.down();
      await page.mouse.move(grabX, targetGrabY, { steps: 5 });
      await page.mouse.up();

      const confirmBtn = page.getByRole('button', {
        name: /confirmar colocación|confirm placement/i,
      });
      await expect(confirmBtn).toBeEnabled({ timeout: 10_000 });
      await confirmBtn.click();

      // De vuelta en la revisión — SIN tocar nada más, el segundo documento
      // deja de decir "Necesita colocación manual" y muestra el detalle de
      // propagación.
      await expect(
        page.getByText(
          /usa la posición que colocaste|en otro sitio libre: el tuyo estaba ocupado|uses the position you placed|in another free spot: yours was taken/i,
        ),
      ).toBeVisible({ timeout: 15_000 });

      await expect(
        page.getByText(/necesita colocación manual|needs manual placement/i),
      ).toHaveCount(0);

      const continuar = page.getByRole('button', { name: /firmar 2 documentos|sign 2 documents/i });
      await expect(continuar).toBeEnabled({ timeout: 10_000 });
      await continuar.click();

      // Paso 3 — certificado + PIN (mismo patrón que
      // firmar-lote-colocador-manual.spec.ts).
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

      // Paso 4 — resultado: los DOS documentos llegan al ZIP, incluido el
      // que se resolvió por propagación sin abrir el colocador.
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

  /**
   * Prueba de muerte del bug P0 (QA post-merge 2026-08-02, code-reviewer +
   * silent-failure-hunter, reproducido de forma independiente por ambos
   * ejecutando en Playwright real): `propagateFrom` reusaba
   * `preflightRun`/`preflightAbort` — los mismos contadores de `goToReview`.
   * Colocar un documento a mano ANTES de que el análisis inicial del lote
   * terminara disparaba `propagateFrom`, que hacía `++preflightRun` y
   * abortaba la corrida de `goToReview` en pleno vuelo: al volver de
   * `preflightBatch`, `goToReview` veía `run !== preflightRun` y hacía
   * `return` sin reconstruir la lista final — los documentos que aún no se
   * habían analizado desaparecían del lote SIN AVISO. Reproducido en la
   * auditoría original con 50 PDFs: colocar uno a mano a mitad del análisis
   * dejó el lote en 17 de 50 documentos.
   *
   * El fixture pesado (`heavy-preflight-pdf.ts`, ~6s de análisis real — ver
   * su doc-comment) da la ventana de tiempo real que la auditoría necesitaba
   * simular con un lote de 50: dos documentos `needs_review` (rápidos, van
   * PRIMERO en el lote) resuelven casi de inmediato, dejando tiempo de sobra
   * para completar la colocación manual en la UI MIENTRAS el pesado (tercero)
   * sigue analizándose — exactamente la ventana donde vivía el bug.
   */
  test('colocar uno a mano mientras el resto del lote sigue analizándose no pierde documentos (bug P0)', async ({
    page,
  }) => {
    test.slow(); // generar el PDF de 22.000 páginas tarda varios segundos en Node
    const cap = attachCapture(page);
    const tmpDir = mkdtempSync(join(tmpdir(), 'fec-lote-p0-'));
    const pathA = join(tmpDir, 'needs-review-a.pdf');
    const pathB = join(tmpDir, 'needs-review-b.pdf');
    const pathHeavy = join(tmpDir, 'heavy.pdf');
    try {
      // A y B: la MISMA función -> misma firma de geometría, la condición
      // que `propagationCandidates` exige para que B sea candidato de A (sin
      // un candidato real, `propagateFrom` retorna antes de tocar
      // `preflightRun`/`preflightAbort` y el bug nunca llega a dispararse).
      writeFileSync(pathA, await buildNoFreeSlotPdf());
      writeFileSync(pathB, await buildNoFreeSlotPdf());
      writeFileSync(pathHeavy, await buildHeavyPreflightPdf());

      await page.goto('/#/firmar-lote');

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.waitFor({ state: 'attached' });
      await fileInput.setInputFiles([pathA, pathB, pathHeavy]);
      await expect(page.getByText(/3 (de|of) \d+ document/i)).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: /revisar los 3|review all 3/i }).click();

      await expect(
        page.getByRole('heading', {
          name: /dónde va a quedar tu firma|where your signature will land/i,
        }),
      ).toBeVisible({ timeout: 15_000 });

      // A y B (needs_review, rápidos) ya resolvieron; el pesado sigue
      // corriendo — el progreso debe mostrar 2 de 3, nunca los 3, aquí.
      const placeByHand = page.getByRole('button', {
        name: /firmar este a mano|sign this one by hand/i,
      });
      await expect(placeByHand).toHaveCount(2, { timeout: 20_000 });
      await expect(page.getByText(/revisando 2 de 3|checking 2 of 3/i)).toBeVisible({
        timeout: 5_000,
      });

      // Coloca A a mano MIENTRAS el pesado sigue analizándose — el momento
      // exacto donde el bug P0 cortaba el análisis inicial.
      await placeByHand.first().click();
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

      // De vuelta en la revisión: el análisis del pesado debe seguir su
      // curso hasta terminar, sin que la colocación manual lo haya cortado.
      await expect(
        page.getByRole('heading', {
          name: /dónde va a quedar tu firma|where your signature will land/i,
        }),
      ).toBeVisible();
      await expect(page.getByText(/revisando \d+ de \d+|checking \d+ of \d+/i)).toHaveCount(0, {
        timeout: 60_000,
      });

      // La prueba de muerte: los TRES documentos siguen en la lista —
      // ninguno desapareció porque la propagación abortó el análisis inicial
      // a medio camino. Contra el código pre-fix, esto queda en 2 (o menos).
      const documentList = page.getByRole('list', {
        name: /documentos del lote|documents in the batch/i,
      });
      await expect(documentList.getByRole('listitem')).toHaveCount(3);

      expect(cap.errors).toEqual([]);
    } finally {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  /**
   * Prueba de muerte del P1 relacionado: si `goToReview` toma el relevo
   * (nuevo `preflightRun`) mientras una propagación sigue corriendo, el
   * `finally` de esa propagación vieja NO limpiaba `propagatingFiles` (su
   * guarda comparaba contra `preflightRun`, ya cambiado) — la fila quedaba
   * `busy` para siempre. El fix hace que `goToReview` limpie
   * `propagatingFiles` explícitamente al arrancar (ver comentario junto a
   * `propagationRun` en `FirmarLote.svelte`).
   *
   * Mismo fixture pesado que la prueba P0, ahora usado para alargar la
   * PROPAGACIÓN en sí (varios candidatos needs_review con la misma firma de
   * geometría que A): da tiempo real para volver al paso 1 y reentrar al
   * paso 2 mientras esa propagación todavía está en vuelo.
   */
  test('volver atrás y reentrar mientras una propagación sigue corriendo no deja filas huérfanas en "busy"', async ({
    page,
  }) => {
    test.slow();
    const cap = attachCapture(page);
    const tmpDir = mkdtempSync(join(tmpdir(), 'fec-lote-p1-'));
    const pathA = join(tmpDir, 'needs-review-a.pdf');
    const pathB = join(tmpDir, 'needs-review-b.pdf');
    const pathHeavy = join(tmpDir, 'heavy.pdf');
    try {
      writeFileSync(pathA, await buildNoFreeSlotPdf());
      writeFileSync(pathB, await buildNoFreeSlotPdf());
      writeFileSync(pathHeavy, await buildHeavyPreflightPdf());

      await page.goto('/#/firmar-lote');

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.waitFor({ state: 'attached' });
      await fileInput.setInputFiles([pathA, pathB, pathHeavy]);
      await expect(page.getByText(/3 (de|of) \d+ document/i)).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: /revisar los 3|review all 3/i }).click();

      // Esperar a que el lote entero termine su análisis inicial ANTES de
      // colocar nada — a diferencia de la prueba P0, aquí lo que se alarga
      // con el pesado es la PROPAGACIÓN posterior, no el análisis inicial.
      await expect(
        page.getByRole('heading', {
          name: /dónde va a quedar tu firma|where your signature will land/i,
        }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/revisando \d+ de \d+|checking \d+ of \d+/i)).toHaveCount(0, {
        timeout: 60_000,
      });

      const placeByHand = page.getByRole('button', {
        name: /firmar este a mano|sign this one by hand/i,
      });
      await placeByHand.first().click();
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

      // La propagación hacia B arrancó — B debería mostrar "Aplicando tu
      // colocación…" mientras corre. No es instantánea (B es un
      // `needs_review` real que vuelve a pasar por el worker), así que hay
      // margen real para actuar mientras sigue en vuelo.
      await expect(page.getByText(/aplicando tu colocación|applying your placement/i)).toBeVisible(
        { timeout: 10_000 },
      );

      // Volver al paso 1 y reentrar al paso 2 MIENTRAS la propagación de B
      // sigue corriendo — el momento exacto del hallazgo P1.
      await page.getByRole('button', { name: /atrás|back/i }).click();
      await expect(page.getByText(/3 (de|of) \d+ document/i)).toBeVisible();
      await page.getByRole('button', { name: /revisar los 3|review all 3/i }).click();

      await expect(
        page.getByRole('heading', {
          name: /dónde va a quedar tu firma|where your signature will land/i,
        }),
      ).toBeVisible({ timeout: 15_000 });

      // La prueba de muerte: ninguna fila queda "Aplicando tu colocación…"
      // para siempre, y el lote termina de analizarse (spinner desaparece,
      // "Continuar" se habilita) sin quedar bloqueado por un `busy` huérfano.
      await expect(
        page.getByText(/aplicando tu colocación|applying your placement/i),
      ).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByText(/revisando \d+ de \d+|checking \d+ of \d+/i)).toHaveCount(0, {
        timeout: 60_000,
      });
      const continuar = page.getByRole('button', {
        name: /firmar \d+ documentos?|sign \d+ documents?/i,
      });
      await expect(continuar).toBeEnabled({ timeout: 10_000 });

      expect(cap.errors).toEqual([]);
    } finally {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  /**
   * Prueba de muerte del hallazgo MEDIUM: "Ajustar" un documento con
   * `propagated: 'exact'|'moved'` construía `updated` con
   * `{...item, status:'ready', page, placement, manual:true}` — el spread
   * arrastraba el `propagated` viejo, así que la fila seguía diciendo "usa la
   * posición que colocaste [en otro documento]" DESPUÉS de que la persona la
   * ajustó a mano ella misma. El fix excluye `propagated` del objeto antes de
   * construir `updated`.
   */
  test('"Ajustar" un documento propagado borra su badge de propagación viejo', async ({ page }) => {
    const cap = attachCapture(page);
    const tmpDir = mkdtempSync(join(tmpdir(), 'fec-lote-p3-'));
    const pathA = join(tmpDir, 'narrow-gap-a.pdf');
    const pathB = join(tmpDir, 'narrow-gap-b.pdf');
    try {
      writeFileSync(pathA, await buildNarrowGapPdf());
      writeFileSync(pathB, await buildNarrowGapPdf());

      await page.goto('/#/firmar-lote');

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.waitFor({ state: 'attached' });
      await fileInput.setInputFiles([pathA, pathB]);
      await expect(page.getByText(/2 (de|of) \d+ document/i)).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: /revisar los 2|review all 2/i }).click();

      await expect(
        page.getByRole('heading', {
          name: /dónde va a quedar tu firma|where your signature will land/i,
        }),
      ).toBeVisible({ timeout: 15_000 });

      const placeByHand = page.getByRole('button', {
        name: /firmar este a mano|sign this one by hand/i,
      });
      await expect(placeByHand.first()).toBeVisible({ timeout: 20_000 });
      await placeByHand.first().click();

      await expect(
        page.getByRole('heading', { name: /coloca la firma|place the signature/i }),
      ).toBeVisible({ timeout: 10_000 });
      await page.locator('.box-overlay').waitFor({ state: 'visible', timeout: 15_000 });
      const sigBoxLocator = page.locator('.sig-box');
      await sigBoxLocator.waitFor({ state: 'visible', timeout: 10_000 });
      await sigBoxLocator.scrollIntoViewIfNeeded();

      const initialBox = await sigBoxLocator.boundingBox();
      if (!initialBox) throw new Error('sig-box sin boundingBox');
      const scale = initialBox.width / DEFAULT_BOX_W_PT;

      const handleLocator = page.locator('.sig-handle');
      const handleBox = await handleLocator.boundingBox();
      if (!handleBox) throw new Error('sig-handle sin boundingBox');
      const handleCenterX = handleBox.x + handleBox.width / 2;
      const handleCenterY = handleBox.y + handleBox.height / 2;
      const targetHandleY = initialBox.y + SHRUNK_BOX_H_PT * scale;

      await page.mouse.move(handleCenterX, handleCenterY, { steps: 3 });
      await page.mouse.down();
      await page.mouse.move(handleCenterX, targetHandleY, { steps: 10 });
      await page.mouse.up();

      await expect(async () => {
        const resized = await sigBoxLocator.boundingBox();
        expect(resized?.height).toBeGreaterThan(SHRUNK_BOX_H_PT * scale - 3);
        expect(resized?.height).toBeLessThan(SHRUNK_BOX_H_PT * scale + 3);
      }).toPass({ timeout: 5_000 });

      const resizedBox = await sigBoxLocator.boundingBox();
      if (!resizedBox) throw new Error('sig-box sin boundingBox tras resize');
      const grabX = resizedBox.x + resizedBox.width / 2;
      const grabY = resizedBox.y + resizedBox.height / 2;
      const deltaPt = TARGET_BOX_BOTTOM_Y_PT - DEFAULT_BOX_BOTTOM_Y_PT;
      const targetGrabY = grabY - deltaPt * scale;

      await page.mouse.move(grabX, grabY);
      await page.mouse.down();
      await page.mouse.move(grabX, targetGrabY, { steps: 5 });
      await page.mouse.up();

      const confirmBtn = page.getByRole('button', {
        name: /confirmar colocación|confirm placement/i,
      });
      await expect(confirmBtn).toBeEnabled({ timeout: 10_000 });
      await confirmBtn.click();

      // B quedó propagado — trae el badge y la acción "Ajustar".
      const propagatedDetail = page.getByText(
        /usa la posición que colocaste|en otro sitio libre: el tuyo estaba ocupado|uses the position you placed|in another free spot: yours was taken/i,
      );
      await expect(propagatedDetail).toBeVisible({ timeout: 15_000 });

      const ajustar = page.getByRole('button', { name: /^ajustar$|^adjust$/i });
      await expect(ajustar).toBeVisible({ timeout: 10_000 });
      await ajustar.click();

      // Reajustar B a mano: el colocador reabre con SU propio rect
      // (propagado). Confirmar tal cual, sin mover nada.
      await expect(
        page.getByRole('heading', { name: /coloca la firma|place the signature/i }),
      ).toBeVisible({ timeout: 10_000 });
      await page.locator('.box-overlay').waitFor({ state: 'visible', timeout: 15_000 });
      await page.locator('.sig-box').waitFor({ state: 'visible', timeout: 10_000 });
      const confirmBtn2 = page.getByRole('button', {
        name: /confirmar colocación|confirm placement/i,
      });
      await expect(confirmBtn2).toBeEnabled({ timeout: 10_000 });
      await confirmBtn2.click();

      // La prueba de muerte: el badge de propagación desapareció — la fila
      // de B ahora dice "Colocada a mano", no "usa la posición que
      // colocaste…". A también dice "Colocada a mano" desde el principio
      // (se colocó a mano primero) — de ahí que el assert se acote a la fila
      // de B por nombre de archivo en vez de buscar el texto en toda la
      // página, donde matchea dos filas legítimamente y viola strict mode.
      await expect(
        page.getByRole('heading', {
          name: /dónde va a quedar tu firma|where your signature will land/i,
        }),
      ).toBeVisible();
      await expect(propagatedDetail).toHaveCount(0);
      const rowB = page.locator('li', { hasText: 'narrow-gap-b.pdf' });
      await expect(rowB.getByText(/colocada a mano|placed by hand/i)).toBeVisible({
        timeout: 10_000,
      });

      expect(cap.errors).toEqual([]);
    } finally {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
