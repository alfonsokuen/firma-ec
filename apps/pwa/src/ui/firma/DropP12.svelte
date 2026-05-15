<script lang="ts">
/**
 * DropP12.svelte — drag&drop + click-to-pick zone para certificado .p12 / .pfx.
 *
 * Variant del Drop.svelte F2. accept=".p12,.pfx,application/x-pkcs12".
 * Max 1 MB (P12 reales son <50KB; 1MB es generoso pero detecta error de tipo).
 * Magic-bytes check (0x30 0x82) lo hace el caller via signer/decoder; aquí
 * solo validamos extensión + tamaño + emite ArrayBuffer.
 */
import { t } from '../../lib/i18n.svelte.ts';

type ErrKey = 'firmar.step3.error_too_large' | 'firmar.step3.error_not_p12';

interface Props {
  /** Recibe el ArrayBuffer + filename del .p12 elegido. */
  onp12: (payload: { p12: ArrayBuffer; fileName: string }) => void;
  onerror?: ((key: ErrKey) => void) | undefined;
  disabled?: boolean;
}

const { onp12, onerror, disabled = false }: Props = $props();

const MAX_BYTES = 1024 * 1024; // 1 MB

let isDragging = $state(false);
let inputEl: HTMLInputElement | undefined = $state();

function isP12(file: File): boolean {
  if (file.type === 'application/x-pkcs12') return true;
  const n = file.name.toLowerCase();
  return n.endsWith('.p12') || n.endsWith('.pfx');
}

function validate(file: File): ErrKey | null {
  if (!isP12(file)) return 'firmar.step3.error_not_p12';
  if (file.size > MAX_BYTES) return 'firmar.step3.error_too_large';
  return null;
}

async function handle(file: File | null | undefined): Promise<void> {
  if (!file) return;
  const err = validate(file);
  if (err) {
    onerror?.(err);
    return;
  }
  try {
    const buf = await file.arrayBuffer();
    onp12({ p12: buf, fileName: file.name });
  } catch {
    onerror?.('firmar.step3.error_not_p12');
  }
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
  if (ev.currentTarget === ev.target) isDragging = false;
}
function onDrop(ev: DragEvent): void {
  ev.preventDefault();
  isDragging = false;
  if (disabled) return;
  void handle(ev.dataTransfer?.files?.[0]);
}
function onPickerChange(ev: Event): void {
  const target = ev.currentTarget as HTMLInputElement;
  void handle(target.files?.[0]);
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
  aria-label={t('firmar.aria.dropzone_p12')}
  aria-disabled={disabled}
  aria-describedby="drop-p12-hint"
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
  class:dropzone-p12-active={isDragging}
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
    <span class="i-lucide-shield-check text-2xl text-brand-500" aria-hidden="true"></span>
  </div>
  <p class="text-base sm:text-lg text-ink-700 dark:text-ink-200">
    <span class="sm:hidden">{t('firmar.step3.dropzone')}</span>
    <span class="hidden sm:inline">{t('firmar.step3.dropzone_desktop')}</span>
  </p>
  <p id="drop-p12-hint" class="text-sm text-ink-600 dark:text-ink-400">
    <span class="font-mono uppercase tracking-wide text-xs">P12</span>
    <span class="mx-1.5 text-ink-400" aria-hidden="true">·</span>
    <span>{t('firmar.step3.hint').replace(/^P12\s*·\s*/i, '')}</span>
  </p>
  <p class="text-xs text-ink-500 dark:text-ink-500 max-w-prose mt-1">
    {t('firmar.step3.eci_hint')}
  </p>
  <input
    bind:this={inputEl}
    type="file"
    accept=".p12,.pfx,application/x-pkcs12"
    class="sr-only"
    tabindex="-1"
    aria-hidden="true"
    {disabled}
    onchange={onPickerChange}
  />
</div>

<style>
  .dropzone-p12-active {
    border-color: var(--firmar-box-stroke-active);
    background-color: oklch(98% 0.025 245);
    box-shadow: var(--shadow-focus);
  }
  :global([data-theme='dark']) .dropzone-p12-active {
    background-color: var(--ink-900);
  }
</style>
