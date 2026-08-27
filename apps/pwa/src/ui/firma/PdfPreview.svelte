<script lang="ts">
/**
 * PdfPreview.svelte — pdfjs-dist v4 canvas renderer.
 *
 * Mini-spec adendum §5.1:
 *   - workerSrc apunta a `/pdfjs/pdf.worker.min.mjs` (same-origin, copiado
 *     desde node_modules en build). NO blob: workers (CSP `worker-src 'self' blob:`).
 *   - `disableFontFace: true` por defecto; si rompe legibilidad, fallback a
 *     `false` (queda para F4 audit).
 *   - `color-scheme: light` forzado en el wrapper para que el canvas no se
 *     oscurezca en dark mode (los PDFs son printed paper).
 *   - Auto-fit al ancho del contenedor; ResizeObserver re-renderiza on resize.
 *   - Page navigation: thumbnail strip lateral (desktop) / dropdown (mobile).
 *
 * Loading skeleton + error card incluidos.
 *
 * Lazy import de pdfjs-dist en el primer effect (no bloquea bundle inicial).
 */
import { onDestroy, onMount, tick, untrack } from 'svelte';
import type { Snippet } from 'svelte';
import {
  type ScannableDoc,
  type SignatureScan,
  scanSignatureWidgets,
} from '../../lib/batch/signatureScan.ts';
import { t, tp } from '../../lib/i18n.svelte.ts';
import type { ExistingSigRect, PageDim } from './smartPlacement.ts';

interface PageRenderInfo {
  pageIndex: number; // 0-based
  /** Canvas CSS size (px). */
  cssWidth: number;
  cssHeight: number;
  /** PDF user-space size (pt). */
  pdfWidth: number;
  pdfHeight: number;
}

interface Props {
  /** PDF bytes — Uint8Array preferred (ArrayBuffer also accepted). */
  pdfBytes: Uint8Array | ArrayBuffer;
  /** 0-based current page (bindable). */
  currentPage?: number;
  /** Callback invoked once after each successful render — gives BoxPlacer the
   *  pixel ↔ pt mapping. */
  onPageRender?: ((info: PageRenderInfo) => void) | undefined;
  /** Callback when total pages becomes known. */
  onLoaded?: ((totalPages: number) => void) | undefined;
  /** v0.15.3 — emitted once after load with the rects of existing signature
   *  widgets (visible ones) + per-page dims, so the parent can place the new
   *  signature box without overlapping prior signatures. Best-effort. */
  onSignaturesScanned?: ((scan: SignatureScan) => void) | undefined;
  /** Optional overlay snippet rendered absolutely over the rendered canvas
   *  (e.g. BoxPlacer). Sized exactly to the current canvas CSS dims so PDF-pt
   *  ↔ DOM-px math in the child stays correct. v0.4.2. */
  overlay?: Snippet<[{ cssWidth: number; cssHeight: number }]>;
  /** When true, after the document loads jump to the LAST page (contracts
   *  are almost always signed on the last page; mobile-first UX). The jump
   *  happens once per PDF load — subsequent user navigation is respected. */
  defaultLastPage?: boolean;
}

let {
  pdfBytes,
  currentPage = $bindable(0),
  onPageRender,
  onLoaded,
  onSignaturesScanned,
  overlay,
  defaultLastPage = false,
}: Props = $props();

/** CSS dims of the most recently rendered canvas, exposed for overlay. */
let lastCssWidth = $state(0);
let lastCssHeight = $state(0);

/** User zoom multiplier on top of auto-fit-width. 1.0 = fit width.
 *  Range [0.5, 3.0]. Mobile UX win: small text in legal PDFs becomes
 *  legible without pinch-zoom gymnastics. */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;
let userZoom = $state(1);
function zoomIn(): void {
  userZoom = Math.min(ZOOM_MAX, Math.round((userZoom + ZOOM_STEP) * 100) / 100);
}
function zoomOut(): void {
  userZoom = Math.max(ZOOM_MIN, Math.round((userZoom - ZOOM_STEP) * 100) / 100);
}
function zoomReset(): void {
  userZoom = 1;
}

type PdfDoc = {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
};
type PdfAnnotation = {
  subtype?: string;
  fieldType?: string;
  rect?: number[];
};
type PdfPage = {
  getViewport(opts: { scale: number }): { width: number; height: number };
  getAnnotations(opts?: { intent?: string }): Promise<PdfAnnotation[]>;
  render(opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }): { promise: Promise<void>; cancel?: () => void };
};

/**
 * Lanza el barrido de widgets de firma y entrega el resultado al padre.
 *
 * La lógica vive en `lib/batch/signatureScan.ts` — fuera de este `<script>` —
 * porque tenía un fallo mudo que ningún test podía alcanzar desde aquí: se
 * tragaba el error de UNA página y el resultado salía con la forma exacta de
 * un escaneo completo. Ahora el resultado distingue «no hay firmas» de «no
 * pude mirar», y quien consume decide qué hacer con esa diferencia.
 */
async function runSignatureScan(doc: PdfDoc, gen: number): Promise<void> {
  if (!onSignaturesScanned) return;
  const scan = await scanSignatureWidgets(doc as unknown as ScannableDoc);
  if (scan.incomplete) {
    // Sólo el conteo — ni nombre de fichero, ni bytes, ni contenido (regla de
    // privacidad del producto). Es el único rastro de que el anti-solape corrió
    // a ciegas sobre parte del documento.
    console.warn(`[PdfPreview] signature scan incomplete: failedPages=${scan.failedPages}`);
  }
  // 🔴 Procedencia: no entregar el escaneo de un documento que ya no es el que
  // este preview tiene cargado. Vive en el emisor y no en cada consumidor, así
  // que cubre a `Firmar` y a `FirmarLote` —que comparten este componente— sin
  // exportarles la disciplina de descarte.
  //
  // Es la SEGUNDA malla — la primera es el mismo token en `loadDoc`, que
  // impide que una carga obsoleta llegue siquiera a lanzar su barrido. Aquí se
  // cubre lo que queda: que el documento cambie **a mitad** del recorrido (el
  // bucle es `await` por página).
  //
  // Se compara la GENERACIÓN y no la identidad de `pdfDoc`, que es lo que
  // había antes y dejaba un hueco: en una recarga sobre la misma instancia,
  // `loadDoc` no pone `pdfDoc` a `null` al empezar — lo reasigna al final —, así
  // que mientras el documento nuevo carga, `pdfDoc` sigue apuntando al viejo y
  // `doc !== pdfDoc` daba `false` para un barrido que ya era obsoleto. `loadGen`
  // avanza al entrar en `loadDoc`, así que no tiene esa ventana.
  //
  // ⚠️ Sin test propio: quitar esta línea deja la suite entera en verde. No es
  // alcanzable desde un e2e (la ventana son ~250 ms, con tope de 50 páginas) y
  // un test que lo intentó pasaba también sin la guarda, así que se retiró en
  // vez de dejar cobertura falsa. La vía que sí cerraría esto es unitaria:
  // inyectar el chequeo de vigencia en el barrido de `signatureScan.ts` y
  // pasarle un doble que caduque entre páginas.
  if (gen !== loadGen || destroyed) return;
  untrack(() => onSignaturesScanned?.(scan));
}

let pdfDoc = $state<PdfDoc | null>(null);
let totalPages = $state(0);
let canvasEl: HTMLCanvasElement | undefined = $state();
let containerEl: HTMLDivElement | undefined = $state();
let phase = $state<'loading' | 'loaded' | 'error'>('loading');
let errMsg = $state<string>('');

let renderTask: { cancel?: () => void } | null = null;
/**
 * Tarea de `getDocument` en vuelo. Se guarda porque el `onDestroy` no tenía
 * nada que cancelar: mientras el `await` no resuelve, `pdfDoc` sigue `null` y
 * su `?.destroy()` es un no-op, así que la carga seguía viva tras desmontar.
 */
let loadTask: { destroy?: () => Promise<void> } | null = null;
/**
 * Generación de carga. Cada `loadDoc()` toma la suya y la comprueba tras cada
 * `await`: una carga vieja que resuelve tarde no puede pisar `pdfDoc`,
 * `totalPages` ni `phase` del documento nuevo. Mismo idioma que el
 * `placementRun` de `Firmar.svelte`, que existe por la misma razón.
 */
let loadGen = 0;
/**
 * `true` desde `onDestroy`. Separa el aborto que pedimos nosotros del fallo de
 * verdad: destruir la tarea hace que su promesa RECHACE («Loading aborted» /
 * «Worker was destroyed»), y sin esta bandera cada vez que alguien vuelve al
 * paso 1 con un PDF cargando saldría un `console.error` de "load failed" sobre
 * una carga que iba perfectamente — contaminando el único canal que distingue
 * "documento difícil" de "infraestructura rota".
 */
let destroyed = false;
let resizeObserver: ResizeObserver | null = null;
let lastBytesRef: Uint8Array | ArrayBuffer | null = null;

/** Load (or re-load) the PDF document. */
async function loadDoc(): Promise<void> {
  const gen = ++loadGen;
  // Al recargar en la MISMA instancia (`$effect` sobre `pdfBytes`) la carga
  // anterior seguía viva: su `getDocument` levanta un Web Worker propio con su
  // copia del PDF, y sin esto cada ida y vuelta dejaba uno colgado.
  const previo = loadTask;
  loadTask = null;
  void previo?.destroy?.();
  phase = 'loading';
  errMsg = '';
  try {
    const pdfjs: any = await import('pdfjs-dist');
    // Configure same-origin worker (CSP: worker-src 'self').
    // Use a stable string path served from /public/pdfjs/.
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';

    // Normalise to a fresh Uint8Array (pdfjs detaches the buffer).
    const u8 =
      pdfBytes instanceof Uint8Array ? new Uint8Array(pdfBytes) : new Uint8Array(pdfBytes.slice(0));

    loadTask = pdfjs.getDocument({
      data: u8,
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: false,
      // Standard-14 fonts (Helvetica/Times/Courier) are frequently NOT embedded
      // — e.g. every ReportLab-generated contract. Without the bundled font data
      // (fetched same-origin, CSP `connect-src 'self'`), pdfjs drops every glyph
      // and the page renders blank. Ships from /public/pdfjs/standard_fonts/.
      standardFontDataUrl: '/pdfjs/standard_fonts/',
    });
    const task = loadTask as { promise: Promise<unknown> };
    // El documento se sostiene en un local: leerlo del estado más abajo era
    // lo que hacía reventar `scanSignatureWidgets(null)` —fuera de su `try`—
    // cuando el desmontaje ya había puesto `pdfDoc` a null, con la promesa
    // rechazada tragada por el `void` del llamante.
    const doc = (await task.promise) as PdfDoc;
    // Carga obsoleta (otro PDF entró por medio) o componente desmontado: no
    // tocar nada. Sin esta guarda, la carga vieja se reponía a sí misma en
    // `pdfDoc` y pintaba el documento anterior sobre el canvas del nuevo.
    if (destroyed || gen !== loadGen) {
      void doc.destroy?.();
      return;
    }
    pdfDoc = doc;
    totalPages = doc.numPages;
    // Untrack callbacks + clamp writes so they don't feed reactive deps back
    // into the loadDoc effect (Svelte 5 effect_update_depth_exceeded).
    untrack(() => {
      onLoaded?.(totalPages);
      if (currentPage < 0) currentPage = 0;
      if (currentPage >= totalPages) currentPage = totalPages - 1;
      // Mobile-first UX: jump to last page on first load when caller opts in
      // (contracts are signed on the last page 95%+ of the time). Only fires
      // when the parent left currentPage at its default (0) — if they
      // already navigated, we respect their choice.
      if (defaultLastPage && currentPage === 0 && totalPages > 1) {
        currentPage = totalPages - 1;
      }
    });
    phase = 'loaded';
    await tick();
    await renderCurrent();
    if (destroyed || gen !== loadGen) return;
    // v0.15.3 — scan for prior signature widgets (anti-overlap placement).
    // Fire-and-forget after first render so it never blocks the preview.
    void runSignatureScan(doc, gen);
  } catch (e) {
    // Aborto que pedimos nosotros (desmontaje o PDF nuevo): ni log ni tarjeta
    // de error. `loadTask.destroy()` hace rechazar la promesa a propósito.
    if (destroyed || gen !== loadGen) return;
    console.error('[PdfPreview] load failed', e);
    phase = 'error';
    errMsg = (e as Error).message ?? 'unknown';
  }
}

async function renderCurrent(): Promise<void> {
  if (!pdfDoc || !canvasEl || !containerEl) return;
  try {
    const page = await pdfDoc.getPage(currentPage + 1);
    const cssWidth = containerEl.clientWidth;
    // Auto-fit: viewport at scale=1 gives PDF point dims; pick scale so canvas
    // CSS width matches container width (capped to 1200px × userZoom to avoid
    // gigantic canvases). userZoom=1 → fit-width (default); >1 = zoom in.
    const baseVp = page.getViewport({ scale: 1 });
    const targetCssWidth = Math.min(cssWidth * userZoom, 1200 * ZOOM_MAX);
    const cssScale = targetCssWidth / baseVp.width;
    const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
    const renderScale = cssScale * dpr;
    const vp = page.getViewport({ scale: renderScale });

    // Cancel previous render task if still running
    try {
      renderTask?.cancel?.();
    } catch {
      /* noop */
    }

    canvasEl.width = Math.floor(vp.width);
    canvasEl.height = Math.floor(vp.height);
    canvasEl.style.width = `${baseVp.width * cssScale}px`;
    // La altura la DERIVA el lienzo de su propia relacion de aspecto (junto al
    // `height: auto` del CSS), en vez de clavarla en pixeles.
    //
    // Clavarla era el defecto: `max-width: 100%` puede recortar el ancho por
    // debajo del que acabamos de pedir --el contenedor se mide antes de que la
    // maquetacion asiente-- pero una altura inline gana a cualquier regla de
    // hoja de estilos y NO se recortaba con el. La pagina se pintaba aplastada
    // (medido en A4: relacion 0,681 en vez de 0,707, un 3,75% mas estrecha) y,
    // como la capa de la caja se dimensionaba con el ancho PRETENDIDO y no con
    // el pintado, la caja aparecia desplazada a la derecha y mas ancha de lo
    // que se iba a estampar. En un contrato a dos columnas eso bastaba para
    // que una firma correcta PARECIERA meterse en el hueco del cofirmante.
    canvasEl.style.height = 'auto';

    const ctx = canvasEl.getContext('2d');
    if (!ctx) throw new Error('2d context not available');
    // Clear before re-render
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    const task = page.render({ canvasContext: ctx, viewport: vp });
    renderTask = task;
    await task.promise;
    renderTask = null;

    // Untrack: parent's onPageRender typically writes $state (pageInfo).
    // Without untrack, that write counts as a dep of the calling $effect →
    // Svelte 5 `effect_update_depth_exceeded` (the cycle observed in
    // Playwright headless Chromium under fast layout).
    // Se mide el lienzo YA MAQUETADO. `baseVp.width * cssScale` es lo que
    // PEDIMOS; esto es lo que el navegador pinta de verdad despues de aplicar
    // `max-width`. Quien consume esto convierte puntos PDF a pixeles con ello,
    // asi que tiene que ser lo segundo: con lo primero, la caja se dibuja en un
    // sitio y se firma en otro.
    const pintado = canvasEl.getBoundingClientRect();
    const info = {
      pageIndex: currentPage,
      cssWidth: pintado.width,
      cssHeight: pintado.height,
      pdfWidth: baseVp.width,
      pdfHeight: baseVp.height,
    };
    lastCssWidth = info.cssWidth;
    lastCssHeight = info.cssHeight;
    untrack(() => onPageRender?.(info));
  } catch (e) {
    // RenderTask cancellations throw; treat as benign.
    const msg = (e as Error).message ?? '';
    if (/cancel/i.test(msg)) return;
    console.error('[PdfPreview] render failed', e);
    phase = 'error';
    errMsg = msg;
  }
}

// Re-load when bytes change.
$effect(() => {
  // Track bytes identity so we re-load only on actual change.
  if (pdfBytes === lastBytesRef) return;
  lastBytesRef = pdfBytes;
  void loadDoc();
});

// Re-render when currentPage changes (and doc is loaded).
// Only `currentPage` should be a reactive dep here — loadDoc() already does
// the first render after pdfDoc/phase transition. Reading phase/pdfDoc
// through untrack avoids re-firing on the very state the load effect just
// wrote (which triggered effect_update_depth_exceeded in headless Chromium).
$effect(() => {
  // touch currentPage AND userZoom so this effect re-runs on either change
  void currentPage;
  void userZoom;
  untrack(() => {
    if (phase === 'loaded' && pdfDoc) {
      void renderCurrent();
    }
  });
});

onMount(() => {
  if (containerEl && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      if (phase === 'loaded') {
        void renderCurrent();
      }
    });
    resizeObserver.observe(containerEl);
  }
});

onDestroy(() => {
  // Antes de destruir nada: lo que rechace a partir de aquí es aborto pedido.
  destroyed = true;
  try {
    renderTask?.cancel?.();
  } catch {
    /* noop */
  }
  resizeObserver?.disconnect();
  // Antes que `pdfDoc`: si la carga aún no resolvió, ESTA es la que hay que
  // abortar (`pdfDoc` todavía es null y su destroy no haría nada).
  void loadTask?.destroy?.();
  loadTask = null;
  void pdfDoc?.destroy();
  pdfDoc = null;
});

function goPrev(): void {
  if (currentPage > 0) currentPage = currentPage - 1;
}
function goNext(): void {
  if (currentPage < totalPages - 1) currentPage = currentPage + 1;
}
function onPageSelect(ev: Event): void {
  const v = Number((ev.currentTarget as HTMLSelectElement).value);
  if (Number.isFinite(v)) currentPage = Math.max(0, Math.min(totalPages - 1, v));
}

const ariaLabel = $derived(tp('firmar.aria.box_placer', {}) /* generic; canvas labelled below */);
</script>

<div class="firmar-pdf-stage" bind:this={containerEl}>
  {#if phase === 'loading'}
    <div class="skeleton" role="status" aria-live="polite" aria-label="Loading PDF">
      <div class="shimmer"></div>
    </div>
  {:else if phase === 'error'}
    <div class="err-card" role="alert">
      <span class="i-lucide-file-warning text-3xl text-err-500 mb-3" aria-hidden="true"></span>
      <p class="font-display font-semibold text-ink-800 dark:text-ink-100 mb-1">
        {t('firmar.error.bad_pdf.title')}
      </p>
      <p class="text-sm text-ink-600 dark:text-ink-300">
        {t('firmar.error.bad_pdf.body')}
      </p>
      {#if errMsg}
        <p class="mt-2 text-xs font-mono text-ink-500 break-words max-w-prose">{errMsg}</p>
      {/if}
    </div>
  {:else}
    {#if totalPages > 1}
      <nav class="page-nav" aria-label="PDF page navigation">
        <button
          type="button"
          onclick={goPrev}
          disabled={currentPage <= 0}
          aria-label="Previous page"
          class="nav-btn"
        >
          <span class="i-lucide-chevron-left text-base" aria-hidden="true"></span>
        </button>
        {#if totalPages <= 30}
          <select
            value={currentPage}
            onchange={onPageSelect}
            aria-label="Jump to page"
            class="nav-select"
          >
            {#each Array.from({ length: totalPages }, (_, i) => i) as i (i)}
              <option value={i}>
                {t('firmar.step2.page_label')} {i + 1} {tp('firmar.step2.page_of', { total: totalPages })}
              </option>
            {/each}
          </select>
        {:else}
          <input
            type="number"
            min="1"
            max={totalPages}
            value={currentPage + 1}
            oninput={(e) => {
              const v = Number((e.currentTarget as HTMLInputElement).value);
              if (Number.isFinite(v) && v >= 1 && v <= totalPages) currentPage = v - 1;
            }}
            aria-label="Page number"
            class="nav-input"
          />
          <span class="text-xs text-ink-500 font-mono">
            {tp('firmar.step2.page_of', { total: totalPages })}
          </span>
        {/if}
        <button
          type="button"
          onclick={goNext}
          disabled={currentPage >= totalPages - 1}
          aria-label="Next page"
          class="nav-btn"
        >
          <span class="i-lucide-chevron-right text-base" aria-hidden="true"></span>
        </button>
      </nav>
    {/if}
    <!-- Zoom controls — fit-width is the default (zoom=1); zoom in/out for
         legibility on mobile without pinch-zoom gymnastics. -->
    {#if phase === 'loaded'}
      <div class="zoom-nav" role="toolbar" aria-label="Zoom controls">
        <button
          type="button"
          onclick={zoomOut}
          disabled={userZoom <= ZOOM_MIN + 0.001}
          aria-label="Reducir zoom"
          class="nav-btn"
        >
          <span class="i-lucide-zoom-out text-base" aria-hidden="true"></span>
        </button>
        <button
          type="button"
          onclick={zoomReset}
          aria-label="Ajustar al ancho (zoom 100%)"
          class="nav-btn zoom-label"
          title="Ajustar al ancho"
        >
          {Math.round(userZoom * 100)}%
        </button>
        <button
          type="button"
          onclick={zoomIn}
          disabled={userZoom >= ZOOM_MAX - 0.001}
          aria-label="Aumentar zoom"
          class="nav-btn"
        >
          <span class="i-lucide-zoom-in text-base" aria-hidden="true"></span>
        </button>
      </div>
    {/if}
    <div class="canvas-wrap">
      <div class="canvas-stack">
        <canvas
          bind:this={canvasEl}
          aria-label={ariaLabel}
        ></canvas>
        {#if overlay && lastCssWidth > 0 && lastCssHeight > 0}
          <div
            class="canvas-overlay"
            style="width: {lastCssWidth}px; height: {lastCssHeight}px;"
          >
            {@render overlay({ cssWidth: lastCssWidth, cssHeight: lastCssHeight })}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .firmar-pdf-stage {
    color-scheme: light;
    background: var(--firmar-pdf-bg, oklch(99% 0 0));
    border-radius: var(--r-lg, 12px);
    padding: 12px;
    min-height: 360px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: var(--shadow-rest);
    /* Permit pinch-zoom on the canvas; BoxPlacer takes pointer capture for drag. */
    touch-action: pinch-zoom;
  }
  .canvas-wrap {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    width: 100%;
    overflow: auto;
  }
  .canvas-stack {
    /* v0.4.2 — local stacking context that the overlay can pin to. Sized by
       the canvas (its only laid-out child); the overlay is absolutely
       positioned and sized inline to match the canvas CSS dims exactly. */
    position: relative;
    display: inline-block;
    line-height: 0;
  }
  .canvas-overlay {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: auto;
    z-index: 10;
  }
  canvas {
    display: block;
    max-width: 100%;
    /* Imprescindible junto a `max-width`: sin esto, recortar el ancho deja la
       altura intacta y la pagina se pinta aplastada. */
    height: auto;
    background: white;
    box-shadow: 0 1px 4px oklch(20% 0.04 250 / 0.08);
  }
  .skeleton {
    height: 480px;
    border-radius: var(--r-md, 8px);
    background: oklch(94% 0 0);
    overflow: hidden;
    position: relative;
  }
  .shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      oklch(98% 0 0 / 0.7) 50%,
      transparent 100%
    );
    animation: shimmer 1.4s linear infinite;
  }
  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .shimmer { animation: none; opacity: 0.5; }
  }
  .err-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 32px 16px;
    border: 1px solid var(--err-500, oklch(58% 0.21 25));
    border-radius: var(--r-md, 8px);
    background: oklch(58% 0.21 25 / 0.05);
  }
  .page-nav {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    align-self: center;
    background: var(--ink-50, oklch(98% 0 0));
    border-radius: var(--r-md, 8px);
    border: 1px solid var(--ink-200, oklch(92% 0 0));
  }
  .nav-btn {
    /* 44×44 = WCAG 2.5.5 Level AAA / Apple HIG mobile touch target minimum.
       Was 36×36 — failed mobile audit. */
    width: 44px;
    height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    color: var(--ink-700);
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .zoom-nav {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    margin-top: 8px;
    align-self: center;
    background: var(--ink-50, oklch(98% 0 0));
    border-radius: var(--r-md, 8px);
    border: 1px solid var(--ink-200, oklch(92% 0 0));
  }
  .zoom-label {
    width: auto;
    min-width: 56px;
    padding: 0 8px;
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }
  .nav-btn:hover:not(:disabled) {
    background: var(--ink-100, oklch(95% 0 0));
  }
  .nav-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .nav-select,
  .nav-input {
    height: 32px;
    padding: 0 8px;
    border-radius: 6px;
    border: 1px solid var(--ink-300, oklch(85% 0 0));
    background: white;
    color: var(--ink-800);
    font: inherit;
    font-size: 0.875rem;
  }
  .nav-input { width: 64px; }
</style>
