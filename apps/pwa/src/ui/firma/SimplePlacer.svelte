<script lang="ts">
import { speakAuto } from '../../lib/guiado/voice.svelte.ts';
/**
 * SimplePlacer.svelte — modo guiado, paso 2: colocación de la firma SIN
 * drag. Auto-coloca la caja al pie de la última página (misma lógica
 * anti-solape que el wizard estándar, `placeAtBottomLastPage`), la muestra
 * resaltada sobre el PDF y pide confirmación humana explícita. La única vía
 * alternativa es una rejilla de hasta 6 posiciones tocables — nunca arrastre
 * libre (plan §1 "Mitigación de los pasos duros").
 */
import { t, tp } from '../../lib/i18n.svelte.ts';
import PdfPreview from './PdfPreview.svelte';
import {
  DEFAULT_SIG_BOX_H,
  DEFAULT_SIG_BOX_W,
  type ExistingSigRect,
  type PageDim,
  type SmartPlacement,
  computeGridPlacements,
  placeAtBottomLastPage,
} from './smartPlacement.ts';

/** Misma forma que `BoxPos` en Firmar.svelte: `page` es 1-based. */
export interface SimplePosition {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  pdfBytes: Uint8Array | ArrayBuffer;
  signerCN: string;
  position?: SimplePosition | null;
  onConfirm: (pos: SimplePosition) => void;
  /** Optional — renders a secondary "Atrás" affordance when the host hides
   *  its own footer for this step (see Firmar.svelte `hideFooter`, step 2
   *  guided: the standard footer's Back/Next would duplicate this panel's
   *  own CTA, so navigation-back is delegated here instead). */
  onBack?: () => void;
}

let { pdfBytes, signerCN, position = $bindable(null), onConfirm, onBack }: Props = $props();

let pageDims = $state<PageDim[]>([]);
let existing = $state<ExistingSigRect[]>([]);
let currentPage = $state(0); // 0-based, bound to PdfPreview
let pdfWidth = $state(0);
let pdfHeight = $state(0);
let showGrid = $state(false);
let announce = $state('');
let scannedOnce = false;
/** Auto-suggested position from `placeAtBottomLastPage`, kept aside so
 *  "Ver la posición sugerida" (`confirmHere`) can restore it after the user
 *  has tried a grid cell — see `confirmHere` below. */
let suggestedPosition = $state<SimplePosition | null>(null);

function onPageRender(info: { pdfWidth: number; pdfHeight: number }): void {
  pdfWidth = info.pdfWidth;
  pdfHeight = info.pdfHeight;
}

function onSignaturesScanned(scan: { widgets: ExistingSigRect[]; pageDims: PageDim[] }): void {
  pageDims = scan.pageDims;
  existing = scan.widgets;
  if (scannedOnce || position) return;
  scannedOnce = true;
  const placed = placeAtBottomLastPage({
    pageDims: scan.pageDims,
    lastPage: currentPage,
    existing: scan.widgets,
    w: DEFAULT_SIG_BOX_W,
    h: DEFAULT_SIG_BOX_H,
  });
  position = placed;
  suggestedPosition = placed;
  announce = t('guided.placer.question');
}

const gridCells = $derived.by((): SmartPlacement[] => {
  if (!showGrid || pageDims.length === 0) return [];
  return computeGridPlacements({ pageDims, page: currentPage, existing });
});

// F3 pulido — narra `ayuda_lugar` (clip pendiente de F2) al abrir la
// rejilla de posiciones. `speakAuto` ya respeta el gate de gesto+voiceAuto
// (voice.svelte.ts), así que esto nunca puede violar la autoplay policy.
function openGrid(): void {
  showGrid = true;
  announce = t('guided.placer.grid_hint');
  void speakAuto('ayuda_lugar');
}

function pickCell(cell: SmartPlacement): void {
  position = cell;
  announce = t('guided.placer.question');
}

function confirmHere(): void {
  // "Ver la posición sugerida" — revert any grid-cell pick back to the
  // auto-suggested spot before closing the grid. If no suggestion was ever
  // computed (position was passed in from a parent, e.g. re-entering step 2
  // with a prior choice), leave the current selection untouched.
  if (suggestedPosition) position = suggestedPosition;
  showGrid = false;
}

function confirm(): void {
  if (!position) return;
  onConfirm(position);
}

const reducedMotion =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Etiqueta corta dentro de la caja resaltada — mismo copy i18n que
 *  BoxPlacer ("Firmado por: <CN>" / "Signed by: <CN>"), truncada para no
 *  desbordar cajas pequeñas. */
const placedLabel = $derived.by((): string => {
  if (!signerCN) return t('firmar.step2.preview_placeholder');
  const max = 28;
  const cn = signerCN.length <= max ? signerCN : `${signerCN.slice(0, max - 1)}…`;
  return tp('firmar.step2.preview_cn', { cn });
});

function toCss(
  p: { x: number; y: number; w: number; h: number },
  cssW: number,
): { left: number; top: number; width: number; height: number } {
  if (pdfWidth <= 0 || pdfHeight <= 0) return { left: 0, top: 0, width: 0, height: 0 };
  const scale = cssW / pdfWidth;
  return {
    left: p.x * scale,
    top: (pdfHeight - (p.y + p.h)) * scale,
    width: p.w * scale,
    height: p.h * scale,
  };
}
</script>

<div class="simple-placer">
  <PdfPreview
    {pdfBytes}
    bind:currentPage
    defaultLastPage
    {onPageRender}
    {onSignaturesScanned}
    overlay={placerOverlay}
  />

  {#snippet placerOverlay({ cssWidth }: { cssWidth: number; cssHeight: number })}
    {#if position && position.page - 1 === currentPage}
      {@const rect = toCss(position, cssWidth)}
      <div
        class="placed-box"
        class:pulse={!reducedMotion}
        style="left:{rect.left}px; top:{rect.top}px; width:{rect.width}px; height:{rect.height}px;"
        aria-hidden="true"
      >
        <span class="placed-label">{placedLabel}</span>
      </div>
    {/if}
    {#if showGrid}
      <div class="grid-overlay" role="group" aria-label={t('guided.placer.grid_hint')}>
        {#each gridCells as cell, i (i)}
          {@const r = toCss(cell, cssWidth)}
          <button
            type="button"
            class="grid-cell"
            class:selected={position?.x === cell.x && position?.y === cell.y && position?.page === cell.page}
            style="left:{r.left}px; top:{r.top}px; width:{r.width}px; height:{r.height}px;"
            onclick={() => pickCell(cell)}
            aria-label="{t('guided.placer.grid_hint')} {i + 1}"
          >
            {i + 1}
          </button>
        {/each}
      </div>
    {/if}
  {/snippet}

  <div class="placer-panel">
    <p class="sr-only" aria-live="polite">{announce}</p>
    {#if onBack && !showGrid}
      <button type="button" class="btn-back" onclick={onBack} aria-label={t('firmar.back')}>
        <span class="i-lucide-chevron-left text-base" aria-hidden="true"></span>
        {t('firmar.back')}
      </button>
    {/if}
    {#if !showGrid}
      <p class="placer-question">{t('guided.placer.question')}</p>
      <div class="placer-actions">
        <button type="button" class="btn-primary" onclick={confirm} disabled={!position}>
          {t('guided.placer.confirm')}
        </button>
        <button type="button" class="btn-secondary" onclick={openGrid}>
          {t('guided.placer.change')}
        </button>
      </div>
    {:else}
      <p class="placer-question">{t('guided.placer.grid_hint')}</p>
      <div class="placer-actions">
        <button type="button" class="btn-primary" onclick={confirm} disabled={!position}>
          {t('guided.placer.grid_confirm')}
        </button>
        <button type="button" class="btn-secondary" onclick={confirmHere}>
          {t('guided.placer.grid_back')}
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .simple-placer {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .placed-box {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border: 3px solid var(--brand-500);
    background: color-mix(in oklch, var(--brand-500) 16%, transparent);
    border-radius: 6px;
    box-shadow: 0 0 0 1px oklch(100% 0 0 / 0.85) inset;
    pointer-events: none;
    overflow: hidden;
  }
  .placed-label {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--brand-600);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pulse {
    animation: placer-pulse 1.8s ease-in-out infinite;
  }
  @keyframes placer-pulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--brand-500) 45%, transparent); }
    50% { box-shadow: 0 0 0 10px color-mix(in oklch, var(--brand-500) 0%, transparent); }
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse { animation: none; }
  }
  .grid-overlay {
    position: absolute;
    inset: 0;
  }
  .grid-cell {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px dashed var(--brand-400);
    background: color-mix(in oklch, var(--brand-400) 12%, transparent);
    border-radius: 6px;
    color: var(--brand-600);
    font-weight: 700;
    cursor: pointer;
  }
  .grid-cell:hover,
  .grid-cell:focus-visible {
    background: color-mix(in oklch, var(--brand-500) 22%, transparent);
    border-style: solid;
  }
  .grid-cell.selected {
    border-style: solid;
    border-color: var(--brand-500);
    background: color-mix(in oklch, var(--brand-500) 24%, transparent);
  }
  .placer-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    text-align: center;
  }
  .placer-question {
    font-weight: 600;
  }
  .placer-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.75rem;
  }
  .btn-primary,
  .btn-secondary {
    min-height: 60px;
    padding: 0.75rem 1.5rem;
    border-radius: var(--r-lg, 12px);
    font-weight: 600;
    cursor: pointer;
  }
  .btn-primary {
    /* AAA a11y (F3b): brand-500 con texto blanco no llega a 4.5:1
       (contraste medido 4.04:1 con axe-core color-contrast). brand-600 sí. */
    background: var(--brand-600);
    color: white;
    border: none;
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-primary:hover:not(:disabled) {
    background: oklch(38% 0.18 245);
  }
  .btn-secondary {
    background: transparent;
    border: 2px solid var(--ink-300, oklch(85% 0 0));
    color: var(--ink-700);
  }
  .btn-secondary:hover {
    background: var(--ink-100, oklch(95% 0 0));
  }
  .btn-back {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    align-self: center;
    min-height: 44px;
    padding: 0.5rem 0.75rem;
    border: none;
    background: transparent;
    color: var(--ink-600, oklch(45% 0 0));
    font-weight: 500;
    font-size: 0.875rem;
    cursor: pointer;
    border-radius: var(--r-lg, 12px);
  }
  .btn-back:hover {
    color: var(--ink-800, oklch(25% 0 0));
    background: var(--ink-100, oklch(95% 0 0));
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
