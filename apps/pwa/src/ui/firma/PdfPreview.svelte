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
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import type { Snippet } from 'svelte';
  import { t, tp } from '../../lib/i18n.svelte.ts';

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
    /** Optional overlay snippet rendered absolutely over the rendered canvas
     *  (e.g. BoxPlacer). Sized exactly to the current canvas CSS dims so PDF-pt
     *  ↔ DOM-px math in the child stays correct. v0.4.2. */
    overlay?: Snippet<[{ cssWidth: number; cssHeight: number }]>;
  }

  let {
    pdfBytes,
    currentPage = $bindable(0),
    onPageRender,
    onLoaded,
    overlay,
  }: Props = $props();

  /** CSS dims of the most recently rendered canvas, exposed for overlay. */
  let lastCssWidth = $state(0);
  let lastCssHeight = $state(0);

  type PdfDoc = {
    numPages: number;
    getPage(n: number): Promise<PdfPage>;
    destroy(): Promise<void>;
  };
  type PdfPage = {
    getViewport(opts: { scale: number }): { width: number; height: number };
    render(opts: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void>; cancel?: () => void };
  };

  let pdfDoc = $state<PdfDoc | null>(null);
  let totalPages = $state(0);
  let canvasEl: HTMLCanvasElement | undefined = $state();
  let containerEl: HTMLDivElement | undefined = $state();
  let phase = $state<'loading' | 'loaded' | 'error'>('loading');
  let errMsg = $state<string>('');

  let renderTask: { cancel?: () => void } | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let lastBytesRef: Uint8Array | ArrayBuffer | null = null;

  /** Load (or re-load) the PDF document. */
  async function loadDoc(): Promise<void> {
    phase = 'loading';
    errMsg = '';
    try {
      const pdfjs: any = await import('pdfjs-dist');
      // Configure same-origin worker (CSP: worker-src 'self').
      // Use a stable string path served from /public/pdfjs/.
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';

      // Normalise to a fresh Uint8Array (pdfjs detaches the buffer).
      const u8 =
        pdfBytes instanceof Uint8Array
          ? new Uint8Array(pdfBytes)
          : new Uint8Array(pdfBytes.slice(0));

      const task = pdfjs.getDocument({
        data: u8,
        disableFontFace: true,
        isEvalSupported: false,
        useSystemFonts: false,
      });
      pdfDoc = (await task.promise) as PdfDoc;
      totalPages = pdfDoc.numPages;
      // Untrack callbacks + clamp writes so they don't feed reactive deps back
      // into the loadDoc effect (Svelte 5 effect_update_depth_exceeded).
      untrack(() => {
        onLoaded?.(totalPages);
        if (currentPage < 0) currentPage = 0;
        if (currentPage >= totalPages) currentPage = totalPages - 1;
      });
      phase = 'loaded';
      await tick();
      await renderCurrent();
    } catch (e) {
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
      // CSS width matches container width (capped to 1200px to avoid huge canvases).
      const baseVp = page.getViewport({ scale: 1 });
      const targetCssWidth = Math.min(cssWidth, 1200);
      const cssScale = targetCssWidth / baseVp.width;
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
      const renderScale = cssScale * dpr;
      const vp = page.getViewport({ scale: renderScale });

      // Cancel previous render task if still running
      try { renderTask?.cancel?.(); } catch { /* noop */ }

      canvasEl.width = Math.floor(vp.width);
      canvasEl.height = Math.floor(vp.height);
      canvasEl.style.width = `${baseVp.width * cssScale}px`;
      canvasEl.style.height = `${baseVp.height * cssScale}px`;

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
      const info = {
        pageIndex: currentPage,
        cssWidth: baseVp.width * cssScale,
        cssHeight: baseVp.height * cssScale,
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
    // touch currentPage so this effect re-runs when the page changes
    void currentPage;
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
    try { renderTask?.cancel?.(); } catch { /* noop */ }
    resizeObserver?.disconnect();
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

  const ariaLabel = $derived(
    tp('firmar.aria.box_placer', {}) /* generic; canvas labelled below */
  );
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
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    color: var(--ink-700);
    background: transparent;
    border: none;
    cursor: pointer;
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
