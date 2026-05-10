<script lang="ts">
  /**
   * Drop.svelte — drag&drop + click-to-pick zone for a single signed PDF.
   *
   * Mobile-first: 44px+ tap targets, native file picker fallback.
   * Validates: MIME/extension is .pdf, size <= 50 MB. Emits `select(File)` on success
   * or `error(messageKey)` on validation failure (caller renders i18n message).
   */
  import { t } from '../lib/i18n.svelte.ts';

  type ErrorKey =
    | 'verificar.error_too_large'
    | 'verificar.error_not_pdf'
    | 'verificar.error_read';

  interface Props {
    onselect: (file: File) => void;
    onerror?: ((key: ErrorKey) => void) | undefined;
    disabled?: boolean;
  }

  const { onselect, onerror, disabled = false }: Props = $props();

  const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

  let isDragging = $state(false);
  let inputEl: HTMLInputElement | undefined = $state();

  function isPdf(file: File): boolean {
    if (file.type === 'application/pdf') return true;
    return file.name.toLowerCase().endsWith('.pdf');
  }

  function validate(file: File): ErrorKey | null {
    if (!isPdf(file)) return 'verificar.error_not_pdf';
    if (file.size > MAX_BYTES) return 'verificar.error_too_large';
    return null;
  }

  function handle(file: File | null | undefined): void {
    if (!file) return;
    const err = validate(file);
    if (err) {
      onerror?.(err);
      return;
    }
    onselect(file);
  }

  function onDragEnter(ev: DragEvent): void {
    ev.preventDefault();
    if (disabled) return;
    isDragging = true;
  }
  function onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    if (disabled) return;
    isDragging = true;
  }
  function onDragLeave(ev: DragEvent): void {
    ev.preventDefault();
    // Only clear when leaving the zone itself (not its children)
    if (ev.currentTarget === ev.target) isDragging = false;
  }
  function onDrop(ev: DragEvent): void {
    ev.preventDefault();
    isDragging = false;
    if (disabled) return;
    const f = ev.dataTransfer?.files?.[0];
    handle(f);
  }
  function onPickerChange(ev: Event): void {
    const target = ev.currentTarget as HTMLInputElement;
    handle(target.files?.[0]);
    // Reset so picking the same file again still triggers change
    target.value = '';
  }
  function onZoneClick(): void {
    if (disabled) return;
    inputEl?.click();
  }
  function onZoneKeydown(ev: KeyboardEvent): void {
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
  aria-label={t('verificar.dropzone_aria')}
  aria-disabled={disabled}
  aria-describedby="drop-hint"
  class="
    group relative w-full min-h-44 px-7 py-10
    rounded-2xl border-2 border-dashed
    flex flex-col items-center justify-center gap-3 text-center
    cursor-pointer select-none
    transition-all duration-200
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950
  "
  class:border-ink-300={!isDragging && !disabled}
  class:dark:border-ink-700={!isDragging && !disabled}
  class:hover:border-brand-400={!isDragging && !disabled}
  class:hover:bg-brand-50={!isDragging && !disabled}
  class:dark:hover:bg-ink-900={!isDragging && !disabled}
  class:dropzone-active={isDragging}
  class:opacity-50={disabled}
  class:cursor-not-allowed={disabled}
  onclick={onZoneClick}
  onkeydown={onZoneKeydown}
  ondragenter={onDragEnter}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
>
  <div
    class="w-14 h-14 rounded-2xl bg-brand-500/10 flex items-center justify-center transition-transform duration-200"
    class:scale-110={isDragging}
  >
    <span class="i-lucide-upload text-2xl text-brand-500" aria-hidden="true"></span>
  </div>
  <p class="text-base sm:text-lg text-ink-700 dark:text-ink-200">
    {t('verificar.dropzone')}
    <span class="text-brand-500 font-medium underline-offset-2 group-hover:underline">
      {t('verificar.dropzone_pick')}
    </span>
  </p>
  <p id="drop-hint" class="text-sm text-ink-600 dark:text-ink-400">
    <span class="font-mono uppercase tracking-wide text-xs">PDF</span>
    <span class="mx-1.5 text-ink-400" aria-hidden="true">·</span>
    <span>{t('verificar.dropzone_hint').replace(/^PDF\s*·\s*/i, '')}</span>
  </p>
  <input
    bind:this={inputEl}
    type="file"
    accept="application/pdf,.pdf"
    class="sr-only"
    tabindex="-1"
    aria-hidden="true"
    {disabled}
    onchange={onPickerChange}
  />
</div>

<style>
  .dropzone-active {
    border-color: oklch(58% 0.21 245);
    background-color: oklch(98% 0.025 245);
    box-shadow: 0 0 0 4px oklch(58% 0.21 245 / 0.15);
  }
  :global([data-theme='dark']) .dropzone-active {
    background-color: oklch(14% 0.04 250);
  }
</style>
