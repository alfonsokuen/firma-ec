<script lang="ts">
/**
 * DropLote.svelte — zona de soltar/elegir VARIOS PDFs.
 *
 * Hermana de `Drop.svelte`, que es de un solo archivo (`files[0]`). Aquí el
 * lote es lo normal, así que se acepta `multiple` y se entrega la tanda entera
 * al llamante: quién se queda y quién se cae lo decide `acceptFiles`, en un solo
 * sitio, para que la regla no viva a la vez en la UI y en el modelo.
 *
 * Se puede soltar varias veces: la segunda tanda se suma a la primera en vez de
 * reemplazarla, que es lo que espera quien arrastra carpetas de dos en dos.
 */
import { t, tp } from '../../lib/i18n.svelte.ts';

interface Props {
  onfiles: (files: File[]) => void;
  disabled?: boolean;
  /** Tope de documentos, solo para el texto de ayuda. */
  max: number;
  /** Tamaño máximo por archivo, ya formateado. */
  maxSizeLabel: string;
  /** Variante compacta para cuando ya hay documentos en la lista. */
  compact?: boolean;
}

const { onfiles, disabled = false, max, maxSizeLabel, compact = false }: Props = $props();

let isDragging = $state(false);
let inputEl: HTMLInputElement | undefined = $state();

function handle(list: FileList | null | undefined): void {
  if (!list || list.length === 0) return;
  onfiles(Array.from(list));
}

function onDragEnter(ev: DragEvent): void {
  ev.preventDefault();
  if (!disabled) isDragging = true;
}
function onDragOver(ev: DragEvent): void {
  ev.preventDefault();
  if (!disabled) isDragging = true;
}
function onDragLeave(ev: DragEvent): void {
  ev.preventDefault();
  if (ev.currentTarget === ev.target) isDragging = false;
}
function onDrop(ev: DragEvent): void {
  ev.preventDefault();
  isDragging = false;
  if (disabled) return;
  handle(ev.dataTransfer?.files);
}
function onPickerChange(ev: Event): void {
  const target = ev.currentTarget as HTMLInputElement;
  handle(target.files);
  // Permite volver a elegir exactamente los mismos archivos.
  target.value = '';
}
function open(): void {
  if (!disabled) inputEl?.click();
}
function onKeydown(ev: KeyboardEvent): void {
  if (disabled) return;
  if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault();
    inputEl?.click();
  }
}
</script>

<div
  role="button"
  tabindex={disabled ? -1 : 0}
  aria-label={t('lote.select.aria')}
  aria-disabled={disabled}
  aria-describedby="lote-drop-hint"
  class="
    group relative w-full rounded-2xl border-2 border-dashed
    flex flex-col items-center justify-center gap-3 text-center
    cursor-pointer select-none transition-all duration-200
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950
  "
  class:min-h-44={!compact}
  class:px-7={!compact}
  class:py-10={!compact}
  class:px-5={compact}
  class:py-5={compact}
  class:border-ink-300={!isDragging && !disabled}
  class:dark:border-ink-700={!isDragging && !disabled}
  class:hover:border-brand-400={!isDragging && !disabled}
  class:hover:bg-brand-50={!isDragging && !disabled}
  class:dark:hover:bg-ink-900={!isDragging && !disabled}
  class:dropzone-lote-active={isDragging}
  class:opacity-50={disabled}
  class:cursor-not-allowed={disabled}
  onclick={open}
  onkeydown={onKeydown}
  ondragenter={onDragEnter}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
>
  <div
    class="rounded-2xl bg-brand-500/10 flex items-center justify-center transition-transform duration-200"
    class:w-14={!compact}
    class:h-14={!compact}
    class:w-10={compact}
    class:h-10={compact}
    class:scale-110={isDragging}
  >
    <span
      class="text-brand-500"
      class:i-lucide-files={!compact}
      class:i-lucide-plus={compact}
      class:text-2xl={!compact}
      class:text-lg={compact}
      aria-hidden="true"
    ></span>
  </div>

  <p class="text-ink-700 dark:text-ink-200" class:text-base={compact} class:sm:text-lg={!compact}>
    {compact ? t('lote.select.add_more') : t('lote.select.dropzone')}
    {#if !compact}
      <span class="text-brand-500 font-medium underline-offset-2 group-hover:underline">
        {t('lote.select.pick')}
      </span>
    {/if}
  </p>

  {#if !compact}
    <p id="lote-drop-hint" class="text-sm text-ink-600 dark:text-ink-400">
      <span class="font-mono uppercase tracking-wide text-xs">PDF</span>
      <span class="mx-1.5 text-ink-400" aria-hidden="true">·</span>
      <span>{tp('lote.select.hint', { max, size: maxSizeLabel })}</span>
    </p>
  {:else}
    <span id="lote-drop-hint" class="sr-only">
      {tp('lote.select.hint', { max, size: maxSizeLabel })}
    </span>
  {/if}

  <input
    bind:this={inputEl}
    type="file"
    accept="application/pdf,.pdf"
    multiple
    class="sr-only"
    tabindex="-1"
    aria-hidden="true"
    {disabled}
    onchange={onPickerChange}
  />
</div>

<style>
  .dropzone-lote-active {
    border-color: var(--firmar-box-stroke-active, oklch(58% 0.21 245));
    background-color: oklch(98% 0.025 245);
    box-shadow: var(--shadow-focus);
  }
  :global([data-theme='dark']) .dropzone-lote-active {
    background-color: var(--ink-900);
  }
</style>
