<script lang="ts">
import { onDestroy, untrack } from 'svelte';
/**
 * PinInput.svelte — secure password field para PIN del .p12.
 *
 * - inputmode="text" (Security Data permite frases — alfanumérico cubre ambos casos).
 * - autocomplete=off + data-1p-ignore + data-lpignore para que password managers
 *   NO ofrezcan guardar el PIN del cert (es distinto al login del usuario).
 * - PIN warning visible permanentemente (Emil-tier: la advertencia ANTES, no después).
 * - Eye toggle 44×44 dentro del input.
 * - onDestroy zero-out + caller debería hacer pin = '' tras submit.
 * - Error state: shake horizontal + border err + clear value.
 */
import { getLang, t } from '../../lib/i18n.svelte.ts';

interface Props {
  /** Bound: contenido del input (caller debería poner '' tras submit). */
  value: string;
  /** Si truthy, muestra error UI + dispara shake. */
  error?: string | null;
  /** Disabled durante validate/import. */
  disabled?: boolean;
  /** CTA primario disparable también con Enter. */
  onsubmit?: (() => void) | undefined;
  /** Notifica cambios al caller (bind:value alternative). */
  oninput?: ((v: string) => void) | undefined;
}

let { value = $bindable(), error = null, disabled = false, onsubmit, oninput }: Props = $props();

let show = $state(false);
let inputEl: HTMLInputElement | undefined = $state();
let lang = $derived(getLang());

// Derived shake key: bumps cada vez que arrives an error message para
// re-disparar la animación incluso si el mensaje es el mismo.
let shakeKey = $state(0);
$effect(() => {
  // Track only the error transition, not our own writes (Svelte 5 effect-loop
  // guard: shakeKey++ and value='' must not feed back as deps of this effect).
  if (error) {
    untrack(() => {
      shakeKey++;
      value = '';
      queueMicrotask(() => inputEl?.focus());
    });
  }
});

function onKeydown(ev: KeyboardEvent): void {
  if (disabled) return;
  if (ev.key === 'Enter') {
    ev.preventDefault();
    onsubmit?.();
  }
}

function onChange(ev: Event): void {
  const t = ev.currentTarget as HTMLInputElement;
  value = t.value;
  oninput?.(t.value);
}

function toggleShow(): void {
  show = !show;
  // Mantener focus en el input
  queueMicrotask(() => inputEl?.focus());
}

onDestroy(() => {
  if (inputEl) inputEl.value = '';
});
</script>

<!-- PIN warning ANTES de que tipee -->
<div
  class="rounded-xl border-l-4 border-warn-500 bg-warn-500/10 px-4 py-3 mb-4"
  role="note"
>
  <p class="text-sm text-ink-700 dark:text-ink-200 leading-relaxed">
    <span class="i-lucide-shield text-warn-500 align-middle inline-block mr-1.5" aria-hidden="true"></span>
    {t('firmar.step4.warn')}
  </p>
</div>

<form autocomplete="off" onsubmit={(e) => { e.preventDefault(); onsubmit?.(); }}>
  <label class="block">
    <span class="text-sm font-medium text-ink-700 dark:text-ink-200 mb-2 block">
      {t('firmar.step4.label')}
    </span>
    <div
      class="relative"
      class:shake={error && shakeKey}
      style="--shake-key: {shakeKey};"
    >
      <input
        bind:this={inputEl}
        type={show ? 'text' : 'password'}
        inputmode="text"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        enterkeyhint="done"
        name=""
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? 'pin-error' : undefined}
        {disabled}
        value={value}
        oninput={onChange}
        onkeydown={onKeydown}
        class="
          w-full h-14 pr-14 pl-4 rounded-md
          border border-ink-300 dark:border-ink-700
          bg-ink-50 dark:bg-ink-900
          text-ink-900 dark:text-ink-50
          font-mono tracking-widest
          focus:outline-none focus:border-brand-500
          disabled:opacity-60 disabled:cursor-not-allowed
        "
        class:border-err-500={!!error}
        class:focus-ring-err={!!error}
        class:focus-ring-ok={!error}
      />
      <button
        type="button"
        aria-label={show ? t('firmar.aria.pin_hide') : t('firmar.aria.pin_show')}
        aria-pressed={show}
        onclick={toggleShow}
        {disabled}
        class="
          absolute top-1/2 right-1 -translate-y-1/2
          w-11 h-11 rounded-md
          flex items-center justify-center
          text-ink-500 hover:text-ink-700 dark:hover:text-ink-200
          focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
        "
      >
        <span
          class="text-lg"
          class:i-lucide-eye-off={show}
          class:i-lucide-eye={!show}
          aria-hidden="true"
        ></span>
      </button>
    </div>
    {#if error}
      <p id="pin-error" class="mt-2 text-sm text-err-500" aria-live="polite">
        {error}
      </p>
    {/if}
  </label>

  <p class="mt-3 text-xs text-ink-500 dark:text-ink-500 leading-relaxed">
    {t('firmar.step4.lost')}
  </p>

  <button
    type="submit"
    {disabled}
    class="
      mt-6 w-full sm:w-auto inline-flex items-center justify-center gap-2
      h-12 px-6 rounded-md
      bg-brand-500 hover:bg-brand-600 active:scale-[0.98]
      text-white font-medium
      transition-all duration-100
      disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-500
      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950
    "
    style="box-shadow: var(--shadow-rest); --tw-ring-color: var(--firmar-accent);"
    aria-label={t('firmar.step4.cta')}
  >
    <span class="i-lucide-key-round text-base" aria-hidden="true"></span>
    {t('firmar.step4.cta')}
  </button>

  <!-- Lang awareness reactive marker (avoids unused warning when bilingual labels live in template). -->
  {#if false}{lang}{/if}
</form>

<style>
  .focus-ring-ok:focus {
    box-shadow: var(--shadow-focus);
  }
  .focus-ring-err:focus {
    box-shadow: 0 0 0 4px oklch(58% 0.21 25 / 0.18);
  }
  /* Shake — el cambio de la custom prop --shake-key fuerza re-run */
  .shake {
    animation: shake-x 360ms var(--motion-curve);
  }
  @keyframes shake-x {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-6px); }
    40% { transform: translateX(6px); }
    60% { transform: translateX(-4px); }
    80% { transform: translateX(4px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .shake {
      animation: none;
    }
  }
</style>
