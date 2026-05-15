<script lang="ts">
import type { ExistingSignature } from '@firma-ec/signer';
/**
 * ExistingSignaturesPanel.svelte — banner inline para multi-firma.
 *
 * Renderiza una card por cada firma existente detectada en el PDF entrante,
 * con CN + signing time + badge "Existente". El adendum decidió simplificar
 * a banner inline (no panel lateral) en MVP — F4 puede expandir.
 *
 * Empty state: el componente NO se renderiza si signatures.length === 0.
 */
import { getLang, t, tp } from '../../lib/i18n.svelte.ts';

interface Props {
  signatures: ExistingSignature[];
}

const { signatures }: Props = $props();

const lang = $derived(getLang());

function fmtDate(d: Date | undefined): string {
  if (!d) return '—';
  return d.toLocaleString(lang === 'es' ? 'es-EC' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
</script>

{#if signatures.length > 0}
  <aside
    class="rounded-2xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 px-5 py-4"
    style="box-shadow: var(--shadow-rest);"
    aria-label={t('firmar.step6.previous_section')}
  >
    <header class="flex items-center gap-2 mb-3">
      <span class="i-lucide-pen-tool text-base text-brand-500" aria-hidden="true"></span>
      <h3 class="text-sm font-display font-semibold text-ink-700 dark:text-ink-200">
        {tp('firmar.step2.previous_banner', { n: signatures.length })}
      </h3>
    </header>
    <ul class="flex flex-col gap-2">
      {#each signatures as sig, i (i)}
        <li
          class="
            flex items-center justify-between gap-3
            px-3 py-2 rounded-md
            bg-white dark:bg-ink-950
            border border-ink-200 dark:border-ink-800
          "
        >
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-ink-800 dark:text-ink-100 truncate">
              {sig.signerCN || '—'}
            </p>
            <p class="text-xs text-ink-500 dark:text-ink-400 font-mono">
              {fmtDate(sig.signingTime)}
            </p>
          </div>
          <span
            class="
              shrink-0 inline-flex items-center gap-1
              text-[10px] font-mono uppercase tracking-wider
              text-ink-500 dark:text-ink-400
              bg-ink-100 dark:bg-ink-800
              border border-ink-200 dark:border-ink-700
              rounded px-2 py-0.5
            "
          >
            <span class="i-lucide-check text-[10px]" aria-hidden="true"></span>
            {lang === 'es' ? 'Existente' : 'Existing'}
          </span>
        </li>
      {/each}
    </ul>
  </aside>
{/if}
