import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * E2E — /firmar-lote NO debe colgar el hilo principal durante el pre-vuelo.
 *
 * Antes de F0 (`4ce07a4`), `preflightBatch` llamaba a `analyzeForPreflight`
 * directamente en el hilo principal, documento a documento. Con un PDF
 * adversarial (varias páginas cerca del techo de contenido por página) esa
 * llamada es CPU-bound y síncrona por dentro de su propio `await`: bloqueaba
 * la UI del navegador mientras corría. F0 movió ese análisis a un Web Worker
 * (`preflight.worker.ts` vía `preflight-bus.ts`) para que el hilo principal
 * quede libre de pintar/responder mientras el worker hace el trabajo pesado.
 *
 * Esta prueba MIDE esa propiedad en vez de asumirla: instala un monitor de
 * responsividad ANTES de que la app cargue (`addInitScript`, no
 * `page.evaluate` después de navegar — si se instala tarde, se pierde
 * exactamente la ventana que importa) y, tras el pre-vuelo del lote,
 * confirma que ningún bloqueo del hilo principal superó el umbral.
 *
 * Dos señales, no una:
 *  1. `PerformanceObserver({entryTypes:['longtask']})` — la señal directa del
 *     navegador para "tarea larga en el hilo principal" (spec: ≥50ms). Puede
 *     no estar soportada en todo entorno headless, así que se envuelve en
 *     `try/catch` y su ausencia no invalida la prueba.
 *  2. Un proxy de `requestAnimationFrame`: si el hilo principal está ocupado,
 *     RAF deja de dispararse y el hueco entre frames crece. Es más portable
 *     que `longtask` (no depende de que el navegador soporte esa entry type)
 *     y mide exactamente lo que a la persona le importa: si la pestaña
 *     siguió respondiendo. Se instala SIEMPRE, sea o no soportado
 *     `longtask`, así la prueba nunca se queda sin ninguna señal.
 *
 * El fixture (`heavy-preflight-pdf.ts`) se genera en caliente, no se commitea
 * — ver el doc-comment de ese módulo para por qué y cuánto tarda.
 */
import { type Page, expect, test } from '@playwright/test';
import { buildHeavyPreflightPdf } from './helpers/heavy-preflight-pdf';

const HERE = dirname(fileURLToPath(import.meta.url));
const NORMAL_PDF = resolve(HERE, 'fixtures/sample.pdf');

/**
 * Cualquier bloqueo del hilo principal por encima de esto se considera un
 * colgado perceptible. 200ms es bastante por encima del piso de `longtask`
 * (50ms) y de una animación a 60fps (16.7ms) — un umbral que solo dispara con
 * un bloqueo que una persona notaría, no con jitter normal de GC/layout.
 */
const BLOCK_THRESHOLD_MS = 200;

interface MonitorResult {
  readonly longtaskSupported: boolean;
  readonly longtaskDurationsMs: number[];
  readonly rafGapsMs: number[];
}

/**
 * Instala el monitor de responsividad ANTES de que cargue cualquier script de
 * la app. `addInitScript` corre en cada documento/navegación de esta `page`,
 * exactamente lo que hace falta aquí (una sola navegación, pero temprano de
 * verdad: antes de que el bundle de la PWA se evalúe).
 */
async function installResponsivenessMonitor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __longtaskDurations: number[];
      __rafGaps: number[];
      __longtaskSupported: boolean;
    };
    w.__longtaskDurations = [];
    w.__rafGaps = [];
    w.__longtaskSupported = false;

    try {
      const supportedTypes = (
        window.PerformanceObserver as unknown as { supportedEntryTypes?: string[] }
      ).supportedEntryTypes;
      if ('PerformanceObserver' in window && (supportedTypes ?? []).includes('longtask')) {
        const obs = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            w.__longtaskDurations.push(entry.duration);
          }
        });
        obs.observe({ type: 'longtask', buffered: true });
        w.__longtaskSupported = true;
      }
    } catch {
      // Entry type no soportado en este Chromium headless: el proxy de RAF
      // de abajo sigue corriendo igual, así que la prueba conserva una señal.
      w.__longtaskSupported = false;
    }

    // Proxy de RAF: se instala SIEMPRE, no solo como fallback de `longtask`.
    let lastFrame = performance.now();
    const tick = (): void => {
      const now = performance.now();
      const gap = now - lastFrame;
      lastFrame = now;
      // Se registra el hueco crudo; el umbral se aplica en el test, no aquí,
      // para poder inspeccionar el peor valor si la aserción falla.
      w.__rafGaps.push(gap);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function readMonitor(page: Page): Promise<MonitorResult> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __longtaskDurations: number[];
      __rafGaps: number[];
      __longtaskSupported: boolean;
    };
    return {
      longtaskSupported: w.__longtaskSupported,
      longtaskDurationsMs: w.__longtaskDurations,
      rafGapsMs: w.__rafGaps,
    };
  });
}

test.describe('firmar.ec — /firmar-lote no bloquea el hilo principal durante el pre-vuelo', () => {
  test('el pre-vuelo de un lote con PDFs pesados no produce longtasks/gaps > 200ms', async ({
    page,
  }) => {
    test.slow(); // generar el PDF de 22.000 páginas (varios segundos en Node) tarda más que el caso feliz

    const tmpDir = mkdtempSync(join(tmpdir(), 'fec-lote-responsividad-'));
    const heavyPdfPath = join(tmpDir, 'heavy-preflight.pdf');
    try {
      const heavyPdfBytes = await buildHeavyPreflightPdf();
      writeFileSync(heavyPdfPath, heavyPdfBytes);

      await installResponsivenessMonitor(page);
      await page.goto('/#/firmar-lote');

      // Dos copias del PDF pesado + uno normal: basta con que UN documento
      // pesado se analice en el hilo principal (pre-F0) para que dispare el
      // umbral; las dos copias dan margen contra flakiness de hardware lento.
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.waitFor({ state: 'attached' });
      await fileInput.setInputFiles([heavyPdfPath, heavyPdfPath, NORMAL_PDF]);
      await expect(page.getByText(/3 (de|of) \d+ document/i)).toBeVisible({ timeout: 20_000 });
      const preflightStartedAt = Date.now();
      await page.getByRole('button', { name: /revisar los 3|review all 3/i }).click();

      // El pre-vuelo corre AQUÍ: entre hacer clic en "revisar" y que el botón
      // de continuar quede habilitado. Es la ventana que el monitor debe
      // haber cubierto — ya estaba instalado desde antes de `goto`.
      await expect(
        page.getByRole('heading', {
          name: /dónde va a quedar tu firma|where your signature will land/i,
        }),
      ).toBeVisible({ timeout: 20_000 });
      const continuar = page.getByRole('button', {
        name: /firmar 3 documentos|sign 3 documents/i,
      });
      // Techo generoso: 3 documentos, dos de ellos pesados, más el arranque
      // del worker y el chunk de @firma-ec/signer que carga dentro de él.
      await expect(continuar).toBeEnabled({ timeout: 60_000 });
      const preflightWallTimeMs = Date.now() - preflightStartedAt;

      const result = await readMonitor(page);

      const worstLongtask = result.longtaskDurationsMs.length
        ? Math.max(...result.longtaskDurationsMs)
        : 0;
      const worstRafGap = result.rafGapsMs.length ? Math.max(...result.rafGapsMs) : 0;

      // eslint-disable-next-line no-console
      console.log(
        `[responsividad] pre-vuelo=${preflightWallTimeMs}ms longtaskSupported=${result.longtaskSupported} ` +
          `longtasks=${result.longtaskDurationsMs.length} peor=${worstLongtask.toFixed(1)}ms ` +
          `rafGaps>${BLOCK_THRESHOLD_MS}ms=${result.rafGapsMs.filter((g) => g > BLOCK_THRESHOLD_MS).length} ` +
          `peorGap=${worstRafGap.toFixed(1)}ms`,
      );

      if (result.longtaskSupported) {
        expect(
          worstLongtask,
          `longtask más larga durante el pre-vuelo: ${worstLongtask.toFixed(1)}ms`,
        ).toBeLessThanOrEqual(BLOCK_THRESHOLD_MS);
      }
      expect(
        worstRafGap,
        `hueco de RAF más largo durante el pre-vuelo: ${worstRafGap.toFixed(1)}ms`,
      ).toBeLessThanOrEqual(BLOCK_THRESHOLD_MS);
    } finally {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
