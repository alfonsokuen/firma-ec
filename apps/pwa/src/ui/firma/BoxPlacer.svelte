<script lang="ts">
/**
 * BoxPlacer.svelte — overlay para colocar y dimensionar el cuadro de firma.
 *
 * Mini-spec adendum §5.2:
 *   - Tap-to-place inicial (idle_no_box → idle_placed). Default 200×60 pt.
 *   - Drag-to-move con pointer capture. Sin transición durante drag.
 *   - Resize por corner handle (bottom-right, 22×22 visible + 22 hit-area).
 *     NO pinch-resize (rompe pinch-zoom natural del canvas).
 *   - Touch ergonomics: el cuadro se renderiza 24px arriba del touch point
 *     mientras drag (el dedo cubre).
 *   - Keyboard: arrow = 1pt, shift+arrow = 10pt.
 *   - Clamp a la página + emit transient warning si fuera de bordes.
 *   - Min 60×20 pt para que la firma no truncate completamente.
 *   - Preview Helvetica WYSIWYG con "Firmado por: <CN>" truncado con ellipsis.
 *
 * Coords: el overlay vive en coords CSS-px del canvas. Las coords PDF son
 * bottom-left origin → invertimos Y al emitir.
 *
 * El componente es agnóstico al tamaño del PDF: recibe `pdfPageSize` (pt) y
 * deriva un canvas-px ↔ pt scale. El parent provee el contenedor (debe tener
 * `position: relative` y dims iguales al canvas del PdfPreview).
 */
import { onMount } from 'svelte';
import { t, tp } from '../../lib/i18n.svelte.ts';

export interface BoxPosition {
  /** 1-based page index (matches the worker SignVisibleSigInput convention). */
  page: number;
  /** PDF user-space coords (origin bottom-left). */
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  /** Page dims in PDF points (pt). */
  pdfPageSize: { w: number; h: number };
  /** CSS pixel dims of the canvas overlay (matches PdfPreview canvas style.width/height). */
  canvasSize: { w: number; h: number };
  /** Common Name extraído del cert (preview). Puede estar vacío hasta paso 4. */
  signerCN: string;
  /** Bound. PDF-pt position. */
  position: BoxPosition | null;
  /** Confirm callback (parent decides if it's required). */
  onConfirm?: ((pos: BoxPosition) => void) | undefined;
  /** v0.4.2 — change callback so parents that don't `bind:` still observe
   *  the auto-placement default + drag/resize updates. */
  onChange?: ((pos: BoxPosition) => void) | undefined;
}

let {
  pdfPageSize,
  canvasSize,
  signerCN,
  position = $bindable(),
  onConfirm,
  onChange,
}: Props = $props();

// ── Constants ────────────────────────────────────────────────────────
// v0.4.5 — FirmaEC-style split layout (QR + 3-line text). Box is 240×72pt.
const DEFAULT_W = 240; // pt
const DEFAULT_H = 72; // pt
const MIN_W = 180; // pt — keep QR + at least the truncated CN visible
const MIN_H = 54; // pt — three 8pt lines + padding
const TOUCH_OFFSET_PX = 24; // finger-cover compensation
const HANDLE_VISUAL = 14; // px square for the corner handle visible dot
const HANDLE_HIT = 28; // px square hit area around the corner

// ── Coord mapping ────────────────────────────────────────────────────
/** scale factor: 1 pt = scale CSS px. */
const scale = $derived(canvasSize.w / pdfPageSize.w);

function ptToCss(pt: number): number {
  return pt * scale;
}
function cssToPt(px: number): number {
  return px / scale;
}

/** PDF (bottom-left) → canvas-CSS (top-left). */
function pdfToCss(p: { x: number; y: number; w: number; h: number }): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  return {
    left: ptToCss(p.x),
    top: ptToCss(pdfPageSize.h - (p.y + p.h)),
    width: ptToCss(p.w),
    height: ptToCss(p.h),
  };
}

/** Clamp a candidate PDF rect to page bounds. Returns clamped + dirty flag. */
function clamp(p: BoxPosition): { clamped: BoxPosition; dirty: boolean } {
  const minW = MIN_W;
  const minH = MIN_H;
  let { x, y, w, h } = p;
  let dirty = false;
  if (w < minW) {
    w = minW;
    dirty = true;
  }
  if (h < minH) {
    h = minH;
    dirty = true;
  }
  if (w > pdfPageSize.w) {
    w = pdfPageSize.w;
    dirty = true;
  }
  if (h > pdfPageSize.h) {
    h = pdfPageSize.h;
    dirty = true;
  }
  if (x < 0) {
    x = 0;
    dirty = true;
  }
  if (y < 0) {
    y = 0;
    dirty = true;
  }
  if (x + w > pdfPageSize.w) {
    x = pdfPageSize.w - w;
    dirty = true;
  }
  if (y + h > pdfPageSize.h) {
    y = pdfPageSize.h - h;
    dirty = true;
  }
  return { clamped: { ...p, x, y, w, h }, dirty };
}

// ── Interaction state ────────────────────────────────────────────────
type Mode = 'idle_no_box' | 'idle_placed' | 'dragging' | 'resizing' | 'keyboard';
let mode = $state<Mode>(position ? 'idle_placed' : 'idle_no_box');

// v0.4.2 — auto-place a centered default box as soon as we have valid page
// dims and no box yet. Previously we waited for the user to tap the overlay,
// but the empty-state hint was rendered over a wider container than the
// canvas, leaving the user confused (visually OFF the PDF). The default sits
// in the lower-right quadrant — typical convention for handwritten signatures.
$effect(() => {
  if (position) return;
  if (!pdfPageSize || pdfPageSize.w <= 0 || pdfPageSize.h <= 0) return;
  if (!canvasSize || canvasSize.w <= 0) return;
  const wPt = Math.min(DEFAULT_W, pdfPageSize.w * 0.6);
  const hPt = Math.min(DEFAULT_H, pdfPageSize.h * 0.2);
  // Default position: horizontally centered, ~12% from the bottom of the page.
  const xPt = (pdfPageSize.w - wPt) / 2;
  const yPt = pdfPageSize.h * 0.12;
  const candidate: BoxPosition = {
    page: 1,
    x: xPt,
    y: yPt,
    w: wPt,
    h: hPt,
  };
  const { clamped } = clamp(candidate);
  position = clamped;
  onChange?.(clamped);
  mode = 'idle_placed';
});

let overlayEl: HTMLDivElement | undefined = $state();
let boxEl: HTMLDivElement | undefined = $state();
let handleEl: HTMLDivElement | undefined = $state();

/** True while we're applying a touch-only render offset (finger ergonomics). */
let liveTouchOffset = $state(false);

/** Drag offset in CSS px from box top-left to pointer (so the box doesn't snap to under-finger). */
let dragOffsetX = 0;
let dragOffsetY = 0;

/** Indicates the last pointer was touch (so we apply TOUCH_OFFSET_PX). */
let isTouchPointer = false;

/** Transient shake to flag clipping events. */
let shakeKey = $state(0);
let oobMessage = $state<string | null>(null);
let oobTimer: ReturnType<typeof setTimeout> | null = null;

function flagClipping(): void {
  shakeKey++;
  oobMessage = t('firmar.error.visible_sig_oob.title');
  if (oobTimer) clearTimeout(oobTimer);
  oobTimer = setTimeout(() => {
    oobMessage = null;
  }, 1800);
}

// ── Geometry derived from `position` ─────────────────────────────────
const cssRect = $derived.by(() => {
  if (!position) return null;
  return pdfToCss(position);
});

// ── Pointer handlers ─────────────────────────────────────────────────
function getCanvasLocal(ev: PointerEvent): { x: number; y: number } {
  const r = overlayEl!.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

function onOverlayPointerDown(ev: PointerEvent): void {
  if (mode !== 'idle_no_box') return;
  // Only place if the pointer hits the empty overlay (not bubbling from box itself).
  if ((ev.target as HTMLElement) !== overlayEl) return;
  isTouchPointer = ev.pointerType === 'touch';
  const local = getCanvasLocal(ev);
  // Center default box on tap point
  const wPt = DEFAULT_W;
  const hPt = DEFAULT_H;
  const cxPt = cssToPt(local.x);
  const cyPt = cssToPt(local.y);
  let xPt = cxPt - wPt / 2;
  // Y: convert from canvas-top to PDF-bottom, applying touch finger offset.
  const localYAdjusted = isTouchPointer ? local.y - TOUCH_OFFSET_PX : local.y;
  const cyAdjPt = cssToPt(localYAdjusted);
  let yPdf = pdfPageSize.h - (cyAdjPt + hPt / 2);
  let yTop = pdfPageSize.h - (yPdf + hPt); // y in PDF
  // Build candidate
  const candidate: BoxPosition = {
    page: position?.page ?? 1,
    x: xPt,
    y: pdfPageSize.h - (cyAdjPt + hPt / 2 + hPt / 2), // re-derive cleanly
    w: wPt,
    h: hPt,
  };
  // Simpler/cleaner: PDF y so that top of box sits at adjusted touch
  candidate.y = pdfPageSize.h - cyAdjPt - hPt / 2;
  const { clamped, dirty } = clamp(candidate);
  if (dirty) flagClipping();
  position = clamped;
  onChange?.(clamped);
  mode = 'idle_placed';
}

function onBoxPointerDown(ev: PointerEvent): void {
  if (!position || !boxEl) return;
  // If the pointerdown is on the corner handle, defer to that handler.
  if ((ev.target as HTMLElement) === handleEl) return;
  ev.preventDefault();
  ev.stopPropagation();
  isTouchPointer = ev.pointerType === 'touch';
  boxEl.setPointerCapture(ev.pointerId);
  const local = getCanvasLocal(ev);
  const css = pdfToCss(position);
  dragOffsetX = local.x - css.left;
  dragOffsetY = local.y - css.top;
  if (isTouchPointer) {
    liveTouchOffset = true;
  }
  mode = 'dragging';
}

function onBoxPointerMove(ev: PointerEvent): void {
  if (mode !== 'dragging' || !position) return;
  const local = getCanvasLocal(ev);
  const newCssLeft = local.x - dragOffsetX;
  let newCssTop = local.y - dragOffsetY;
  if (isTouchPointer) newCssTop -= TOUCH_OFFSET_PX;
  const xPt = cssToPt(newCssLeft);
  // canvas top → PDF bottom origin
  const yPt = pdfPageSize.h - cssToPt(newCssTop) - position.h;
  const candidate = { ...position, x: xPt, y: yPt };
  const { clamped, dirty } = clamp(candidate);
  if (dirty) flagClipping();
  position = clamped;
  onChange?.(clamped);
}

function onBoxPointerUp(ev: PointerEvent): void {
  if (mode !== 'dragging') return;
  try {
    boxEl?.releasePointerCapture(ev.pointerId);
  } catch {
    /* noop */
  }
  liveTouchOffset = false;
  mode = 'idle_placed';
}

// Resize handlers
function onHandlePointerDown(ev: PointerEvent): void {
  if (!position || !handleEl) return;
  ev.preventDefault();
  ev.stopPropagation();
  handleEl.setPointerCapture(ev.pointerId);
  mode = 'resizing';
}

function onHandlePointerMove(ev: PointerEvent): void {
  if (mode !== 'resizing' || !position) return;
  const local = getCanvasLocal(ev);
  // Pointer position determines the new bottom-right of the box (in CSS px).
  const css = pdfToCss(position);
  const newWCss = Math.max(ptToCss(MIN_W), local.x - css.left);
  const newHCss = Math.max(ptToCss(MIN_H), local.y - css.top);
  const candidate = {
    ...position,
    w: cssToPt(newWCss),
    h: cssToPt(newHCss),
  };
  const { clamped, dirty } = clamp(candidate);
  if (dirty) flagClipping();
  position = clamped;
  onChange?.(clamped);
}

function onHandlePointerUp(ev: PointerEvent): void {
  if (mode !== 'resizing') return;
  try {
    handleEl?.releasePointerCapture(ev.pointerId);
  } catch {
    /* noop */
  }
  mode = 'idle_placed';
}

// ── Keyboard nav ─────────────────────────────────────────────────────
function onBoxKeydown(ev: KeyboardEvent): void {
  if (!position) return;
  const step = ev.shiftKey ? 10 : 1;
  let dx = 0,
    dy = 0;
  switch (ev.key) {
    case 'ArrowLeft':
      dx = -step;
      break;
    case 'ArrowRight':
      dx = step;
      break;
    case 'ArrowUp':
      dy = step;
      break; // PDF y up = visual up
    case 'ArrowDown':
      dy = -step;
      break;
    case 'Enter':
    case ' ':
      ev.preventDefault();
      if (position && onConfirm) onConfirm(position);
      return;
    default:
      return;
  }
  ev.preventDefault();
  const candidate = { ...position, x: position.x + dx, y: position.y + dy };
  const { clamped, dirty } = clamp(candidate);
  if (dirty) flagClipping();
  position = clamped;
  onChange?.(clamped);
  mode = 'keyboard';
}

function onBoxFocus(): void {
  if (mode === 'idle_placed') mode = 'keyboard';
}
function onBoxBlur(): void {
  if (mode === 'keyboard') mode = 'idle_placed';
}

function confirm(): void {
  if (!position) return;
  onConfirm?.(position);
}

// ── Helvetica WYSIWYG preview ────────────────────────────────────────
/** Pick a font-size in CSS px that fits the box height (3 lines, ~8pt each). */
const previewFontPx = $derived.by(() => {
  if (!position) return 9;
  // 8pt baseline → CSS px, capped to readable range.
  const ptSize = Math.max(7, Math.min(11, Math.round(position.h / 9)));
  return ptSize * scale;
});

/** v0.4.5 — Three lines for the split layout preview. */
function truncatePreview(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
const previewLine1 = $derived(
  signerCN
    ? `Firmado por: ${truncatePreview(signerCN, 35)}`
    : t('firmar.step2.preview_placeholder'),
);
const previewLine2 = $derived.by(() => {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `Fecha: ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
});
const previewLine3 = 'Razón: firmar.ec';

const ariaPositionLabel = $derived(
  position
    ? tp('firmar.aria.box_position', {
        x: Math.round(position.x),
        y: Math.round(position.y),
        w: Math.round(position.w),
        h: Math.round(position.h),
      })
    : '',
);

// Make sure to release listeners on body for resize/drag pointermove on capture; we use box-level listeners since pointer capture redirects events.

onMount(() => {
  return () => {
    if (oobTimer) clearTimeout(oobTimer);
  };
});
</script>

<div
  class="box-overlay"
  bind:this={overlayEl}
  style="width: {canvasSize.w}px; height: {canvasSize.h}px;"
  onpointerdown={onOverlayPointerDown}
  role="presentation"
>
  {#if mode === 'idle_no_box'}
    <div class="hint" aria-hidden="true">
      <span class="i-lucide-hand text-2xl mb-1"></span>
      <p class="text-sm font-medium">{t('firmar.step2.subtitle_mobile')}</p>
    </div>
  {/if}

  {#if position && cssRect}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_role_supports_aria_props -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      bind:this={boxEl}
      class="sig-box"
      class:active={mode === 'dragging' || mode === 'resizing'}
      class:shake={shakeKey > 0 && oobMessage}
      role="application"
      tabindex="0"
      aria-label={t('firmar.aria.box_placer') + ' — ' + ariaPositionLabel}
      style="
        left: {cssRect.left}px;
        top: {cssRect.top - (liveTouchOffset && mode === 'dragging' ? TOUCH_OFFSET_PX : 0)}px;
        width: {cssRect.width}px;
        height: {cssRect.height}px;
        --shake-key: {shakeKey};
      "
      onpointerdown={onBoxPointerDown}
      onpointermove={onBoxPointerMove}
      onpointerup={onBoxPointerUp}
      onpointercancel={onBoxPointerUp}
      onkeydown={onBoxKeydown}
      onfocus={onBoxFocus}
      onblur={onBoxBlur}
    >
      <div
        class="sig-preview-split"
        style="font-size: {previewFontPx}px; line-height: 1.2;"
        aria-hidden="true"
      >
        <div class="sig-qr-placeholder" aria-label={t('firmar.qr_label')}>
          <span class="sig-qr-grid"></span>
          <span class="sig-qr-label">QR</span>
        </div>
        <div class="sig-text-block">
          <div class="sig-text-line">{previewLine1}</div>
          <div class="sig-text-line sig-text-muted">{previewLine2}</div>
          <div class="sig-text-line sig-text-muted">{previewLine3}</div>
        </div>
      </div>
      <div
        bind:this={handleEl}
        class="sig-handle"
        role="slider"
        tabindex="-1"
        aria-label="Resize signature box"
        aria-valuemin={MIN_W}
        aria-valuemax={Math.round(pdfPageSize.w)}
        aria-valuenow={Math.round(position.w)}
        onpointerdown={onHandlePointerDown}
        onpointermove={onHandlePointerMove}
        onpointerup={onHandlePointerUp}
        onpointercancel={onHandlePointerUp}
      ></div>
    </div>
  {/if}

  {#if oobMessage}
    <div class="oob-toast" role="status" aria-live="polite">
      {oobMessage}
    </div>
  {/if}
</div>

<!-- v0.4.2 — confirm-bar removed: the wizard footer's Next button is the
     single advance CTA. Keeping two redundant Continuar buttons (one over
     the PDF stage, one in the footer) was the #2 cause of P0 confusion. -->


<style>
  .box-overlay {
    position: absolute;
    inset: 0;
    margin: 0 auto;
    z-index: 10;
    touch-action: none;
    /* No background — overlays the canvas. */
  }
  .hint {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--ink-500, oklch(60% 0.02 250));
    pointer-events: none;
    user-select: none;
  }
  .sig-box {
    position: absolute;
    /* v0.4.2 — solid 2.5px border + soft ring + warmer translucent fill so the
       box reads clearly against the white PDF page even on small screens. */
    border: 2.5px solid var(--firmar-box-stroke, oklch(58% 0.21 245 / 0.95));
    background: oklch(58% 0.21 245 / 0.10);
    border-radius: 4px;
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
    box-sizing: border-box;
    box-shadow:
      0 0 0 1px oklch(100% 0 0 / 0.85) inset,
      0 2px 6px oklch(20% 0.04 250 / 0.18);
    /* No transition during drag/resize — direct pointer follow.
       Resting state gets a small smooth so the focus ring comes in nicely. */
    transition: box-shadow 120ms cubic-bezier(0.32, 0.72, 0, 1),
                border-color 120ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  .sig-box:focus-visible {
    outline: none;
    box-shadow: 0 0 0 4px var(--firmar-accent-glow, oklch(58% 0.21 245 / 0.18));
  }
  .sig-box.active {
    border-style: solid;
    border-color: var(--firmar-box-stroke-active, oklch(58% 0.21 245));
    background: oklch(58% 0.21 245 / 0.08);
    cursor: grabbing;
    box-shadow: 0 4px 12px oklch(20% 0.04 250 / 0.12);
  }
  /* v0.4.5 — Split preview: 60×60 QR placeholder on the left + 3 lines on the right. */
  .sig-preview-split {
    position: absolute;
    inset: 6px 24px 6px 6px; /* internal margins (PADDING_PT≈6 in PDF pt) */
    display: flex;
    gap: 6px;
    align-items: stretch;
    overflow: hidden;
    pointer-events: none;
    color: oklch(20% 0.04 250);
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-weight: 400;
  }
  .sig-qr-placeholder {
    flex: 0 0 auto;
    width: 25%;
    max-width: 60%;
    aspect-ratio: 1 / 1;
    position: relative;
    background:
      linear-gradient(45deg, oklch(85% 0 0) 25%, transparent 25%) 0 0 / 6px 6px,
      linear-gradient(-45deg, oklch(85% 0 0) 25%, transparent 25%) 0 0 / 6px 6px,
      oklch(98% 0 0);
    border: 1px solid oklch(60% 0.02 250 / 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .sig-qr-label {
    font-size: 0.75em;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: oklch(40% 0.02 250);
    background: oklch(100% 0 0 / 0.85);
    padding: 1px 4px;
    border-radius: 2px;
  }
  .sig-text-block {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    gap: 2px;
    overflow: hidden;
  }
  .sig-text-line {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sig-text-muted {
    color: oklch(40% 0.02 250);
  }
  .sig-handle {
    position: absolute;
    right: -14px;
    bottom: -14px;
    width: 28px;
    height: 28px;
    /* Hit-area is 28px square; visual marker is the inner box. */
    cursor: nwse-resize;
    touch-action: none;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .sig-handle::before {
    content: '';
    width: 14px;
    height: 14px;
    border-radius: 3px;
    background: var(--firmar-box-stroke-active, oklch(58% 0.21 245));
    border: 2px solid white;
    box-shadow: 0 1px 3px oklch(20% 0.04 250 / 0.25);
  }
  .oob-toast {
    position: absolute;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    background: oklch(58% 0.21 25);
    color: white;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    pointer-events: none;
    z-index: 20;
    animation: toast-in 200ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  @keyframes toast-in {
    0% { opacity: 0; transform: translate(-50%, 8px); }
    100% { opacity: 1; transform: translate(-50%, 0); }
  }
  .shake {
    animation: shake-x 320ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  @keyframes shake-x {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-4px); }
    75% { transform: translateX(4px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .shake { animation: none; }
  }
</style>
