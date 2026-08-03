<script lang="ts">
/**
 * LoteList.svelte — la lista de documentos del lote, en los tres pasos.
 *
 * Deliberadamente tonta: recibe filas ya resueltas y traducidas y solo las
 * pinta. Quién decide el estado de un documento es la ruta; que la lista no lo
 * sepa es lo que permite usar la misma en "elegidos", "revisados" y "firmando"
 * sin tres variantes que se desincronizan.
 *
 * Sin cards: filas separadas por 1px. Una lista de 50 documentos con 50 cajas
 * con sombra es ruido, no jerarquía — la caja se reserva para lo que de verdad
 * se eleva sobre el resto.
 */
import { t } from '../../lib/i18n.svelte.ts';

export type LoteRowTone = 'neutral' | 'ok' | 'warn' | 'err' | 'busy';

export interface LoteRow {
  readonly id: string;
  readonly name: string;
  /** Tamaño ya formateado, o metadatos cortos (páginas). */
  readonly meta?: string;
  /** Estado ya traducido. */
  readonly statusLabel?: string;
  /** Detalle ya traducido: dónde cae la firma, o por qué no. */
  readonly detail?: string;
  readonly tone: LoteRowTone;
  readonly removable?: boolean;
}

interface Props {
  rows: LoteRow[];
  onremove?: ((id: string) => void) | undefined;
  /** Nombre accesible de la lista. */
  ariaLabel?: string | undefined;
}

const { rows, onremove, ariaLabel }: Props = $props();

const ICON: Record<LoteRowTone, string> = {
  neutral: 'i-lucide-file-text',
  ok: 'i-lucide-check',
  warn: 'i-lucide-alert-triangle',
  err: 'i-lucide-x',
  busy: 'i-lucide-loader-2',
};
</script>

<ul
  class="divide-y divide-ink-200 dark:divide-ink-800 border-y border-ink-200 dark:border-ink-800"
  aria-label={ariaLabel ?? t('lote.aria.list')}
>
  {#each rows as row (row.id)}
    <li class="flex items-center gap-3 py-3 px-1 lote-row">
      <span
        class="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
        class:tone-neutral={row.tone === 'neutral'}
        class:tone-ok={row.tone === 'ok'}
        class:tone-warn={row.tone === 'warn'}
        class:tone-err={row.tone === 'err'}
        class:tone-busy={row.tone === 'busy'}
      >
        <span
          class="text-base {ICON[row.tone]}"
          class:spin={row.tone === 'busy'}
          aria-hidden="true"
        ></span>
      </span>

      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium text-ink-800 dark:text-ink-100" title={row.name}>
          {row.name}
        </p>
        <p class="truncate text-xs text-ink-600 dark:text-ink-400">
          {#if row.statusLabel}<span>{row.statusLabel}</span>{/if}
          {#if row.statusLabel && (row.detail || row.meta)}
            <span class="mx-1 text-ink-400" aria-hidden="true">·</span>
          {/if}
          {#if row.detail}<span>{row.detail}</span>{:else if row.meta}<span class="font-mono">{row.meta}</span>{/if}
        </p>
      </div>

      {#if row.meta && row.detail}
        <span class="hidden sm:inline shrink-0 text-xs font-mono text-ink-500 dark:text-ink-500">
          {row.meta}
        </span>
      {/if}

      {#if row.removable && onremove}
        <button
          type="button"
          onclick={() => onremove(row.id)}
          aria-label={t('lote.select.remove_aria').replace('{name}', row.name)}
          class="
            shrink-0 w-11 h-11 -mr-1 rounded-md
            flex items-center justify-center
            text-ink-500 hover:text-err-500
            hover:bg-ink-100 dark:hover:bg-ink-800
            transition-colors duration-150
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
          "
        >
          <span class="i-lucide-x text-base" aria-hidden="true"></span>
        </button>
      {/if}
    </li>
  {/each}
</ul>

<style>
  /* Entrada escalonada muy corta: la lista se puebla de golpe al soltar
     archivos y el escalonado deja ver que son varios, no uno. Decorativa: no
     bloquea nada y desaparece con reduced-motion. */
  .lote-row {
    animation: row-in 180ms cubic-bezier(0.23, 1, 0.32, 1) backwards;
  }
  .lote-row:nth-child(1) { animation-delay: 0ms; }
  .lote-row:nth-child(2) { animation-delay: 24ms; }
  .lote-row:nth-child(3) { animation-delay: 48ms; }
  .lote-row:nth-child(4) { animation-delay: 72ms; }
  .lote-row:nth-child(n + 5) { animation-delay: 90ms; }

  @keyframes row-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .tone-neutral { background: var(--ink-100); color: var(--ink-600); }
  :global([data-theme='dark']) .tone-neutral { background: var(--ink-800); color: var(--ink-400); }
  .tone-ok { background: oklch(92% 0.07 155); color: oklch(45% 0.14 155); }
  :global([data-theme='dark']) .tone-ok { background: oklch(28% 0.07 155); color: oklch(78% 0.14 155); }
  .tone-warn { background: oklch(94% 0.08 85); color: oklch(48% 0.13 70); }
  :global([data-theme='dark']) .tone-warn { background: oklch(30% 0.07 70); color: oklch(84% 0.13 85); }
  .tone-err { background: oklch(94% 0.05 25); color: oklch(50% 0.19 25); }
  :global([data-theme='dark']) .tone-err { background: oklch(28% 0.07 25); color: oklch(80% 0.14 25); }
  .tone-busy { background: var(--brand-500) / 0.12; color: var(--brand-500); }

  .spin {
    animation: spin 900ms linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .lote-row { animation: none; }
    .spin { animation-duration: 2.4s; }
  }
</style>
