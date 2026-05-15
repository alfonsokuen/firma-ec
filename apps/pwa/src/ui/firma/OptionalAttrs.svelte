<script lang="ts">
/**
 * OptionalAttrs.svelte — disclosure colapsable con dos inputs opcionales
 * (razón + lugar) que van como signedAttrs en el CMS, NO en el cuadro visible.
 *
 * Sanitización inline: stripear chars que no sean letras/dígitos/espacio/.,:;-_/.
 * Counter dinámico (n/200), color shifts a warn cuando >180.
 */
import { t, tp } from '../../lib/i18n.svelte.ts';

interface Props {
  razon: string;
  lugar: string;
}

let { razon = $bindable(), lugar = $bindable() }: Props = $props();

let open = $state(razon.length > 0 || lugar.length > 0);

const MAX = 200;
// Allow letters (any unicode), digits, whitespace, common punctuation.
const ALLOWED = /[^\p{L}\p{N}\s.,:;\-_/]/gu;

function sanitize(raw: string): string {
  return raw.replace(ALLOWED, '').slice(0, MAX);
}

function onRazonInput(ev: Event): void {
  const v = (ev.currentTarget as HTMLInputElement).value;
  razon = sanitize(v);
}
function onLugarInput(ev: Event): void {
  const v = (ev.currentTarget as HTMLInputElement).value;
  lugar = sanitize(v);
}

const razonCount = $derived(razon.length);
const lugarCount = $derived(lugar.length);
const razonNearLimit = $derived(razonCount > 180);
const lugarNearLimit = $derived(lugarCount > 180);
</script>

<div class="rounded-xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900">
  <button
    type="button"
    onclick={() => (open = !open)}
    aria-expanded={open}
    aria-controls="optional-attrs-panel"
    class="
      w-full flex items-center justify-between gap-3
      px-5 py-4 text-left
      min-h-11
      hover:bg-ink-100 dark:hover:bg-ink-800
      rounded-xl
      transition-colors duration-100
      focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset
    "
  >
    <span class="text-sm font-medium text-ink-700 dark:text-ink-200">
      {t('firmar.step5.disclosure')}
    </span>
    <span
      class="i-lucide-chevron-down text-ink-500 transition-transform duration-150"
      class:rotate-180={open}
      aria-hidden="true"
    ></span>
  </button>

  {#if open}
    <div
      id="optional-attrs-panel"
      class="px-5 pb-5 pt-1 flex flex-col gap-5 border-t border-ink-200 dark:border-ink-800"
    >
      <p class="text-sm text-ink-600 dark:text-ink-400 mt-3">
        {t('firmar.step5.subtitle')}
      </p>

      <!-- Razón -->
      <label class="block">
        <span class="flex items-center justify-between mb-1.5">
          <span class="text-sm font-medium text-ink-700 dark:text-ink-200">
            {t('firmar.step5.reason_label')}
          </span>
          <span
            class="text-xs font-mono"
            class:text-ink-500={!razonNearLimit}
            class:text-warn-500={razonNearLimit}
          >
            {tp('firmar.step5.counter', { n: razonCount })}
          </span>
        </span>
        <input
          type="text"
          maxlength={MAX}
          value={razon}
          oninput={onRazonInput}
          placeholder={t('firmar.step5.reason_placeholder')}
          class="
            w-full h-11 px-4 rounded-md
            border border-ink-300 dark:border-ink-700
            bg-white dark:bg-ink-950
            text-ink-900 dark:text-ink-50
            placeholder:text-ink-400
            focus:outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/30
          "
          autocomplete="off"
          autocapitalize="sentences"
          spellcheck="true"
        />
      </label>

      <!-- Lugar -->
      <label class="block">
        <span class="flex items-center justify-between mb-1.5">
          <span class="text-sm font-medium text-ink-700 dark:text-ink-200">
            {t('firmar.step5.location_label')}
          </span>
          <span
            class="text-xs font-mono"
            class:text-ink-500={!lugarNearLimit}
            class:text-warn-500={lugarNearLimit}
          >
            {tp('firmar.step5.counter', { n: lugarCount })}
          </span>
        </span>
        <input
          type="text"
          maxlength={MAX}
          value={lugar}
          oninput={onLugarInput}
          placeholder={t('firmar.step5.location_placeholder')}
          class="
            w-full h-11 px-4 rounded-md
            border border-ink-300 dark:border-ink-700
            bg-white dark:bg-ink-950
            text-ink-900 dark:text-ink-50
            placeholder:text-ink-400
            focus:outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/30
          "
          autocomplete="off"
          autocapitalize="words"
          spellcheck="true"
        />
      </label>
    </div>
  {/if}
</div>
