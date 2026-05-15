<script lang="ts">
/**
 * SignSummary.svelte — pre-firma summary (paso 6).
 *
 * Card secundaria con secciones: documento, cuadro, firmante, detalles
 * (razón/lugar opcional). Sigue el lenguaje visual de Detail.svelte F2:
 * dl key/value, jerarquía moderada, mono font para datos técnicos.
 */
import { getLang, t, tp } from '../../lib/i18n.svelte.ts';

interface PdfInfo {
  name: string;
  /** Bytes; UI lo formatea a KB. */
  size: number;
}

interface VisibleSig {
  /** 1-based page index. */
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  pdf: PdfInfo;
  visibleSig: VisibleSig;
  /** Common Name extraído del cert. */
  signerCN: string;
  /** Local datetime (Date object) — se renderiza en locale del lang. */
  signingTime: Date;
  razon?: string;
  lugar?: string;
}

const { pdf, visibleSig, signerCN, signingTime, razon = '', lugar = '' }: Props = $props();

const lang = $derived(getLang());

const sizeKB = $derived(Math.max(1, Math.round(pdf.size / 1024)));
const dateFmt = $derived(
  signingTime.toLocaleString(lang === 'es' ? 'es-EC' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }),
);
const sizeLabelKey = $derived(
  visibleSig.w >= 200
    ? ('firmar.step2.size.large' as const)
    : visibleSig.w >= 140
      ? ('firmar.step2.size.standard' as const)
      : ('firmar.step2.size.compact' as const),
);
const boxValue = $derived(
  tp('firmar.step6.box_value', {
    p: visibleSig.page,
    size: t(sizeLabelKey),
    x: Math.round(visibleSig.x),
    y: Math.round(visibleSig.y),
  }),
);
</script>

<section
  class="rounded-2xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900"
  style="box-shadow: var(--shadow-rest);"
  aria-labelledby="sign-summary-title"
>
  <header class="px-6 py-4 border-b border-ink-200 dark:border-ink-800">
    <h2
      id="sign-summary-title"
      class="text-base font-display font-semibold text-ink-700 dark:text-ink-200"
    >
      {t('firmar.step6.summary')}
    </h2>
  </header>

  <dl class="px-6 py-5 grid gap-x-6 gap-y-4 sm:grid-cols-[max-content_1fr] text-sm">
    <!-- Documento -->
    <dt class="text-ink-500 dark:text-ink-400 font-medium pt-0.5">
      {t('firmar.step6.doc_section')}
    </dt>
    <dd class="text-ink-800 dark:text-ink-100 min-w-0">
      <p class="truncate font-medium">{pdf.name}</p>
      <p class="text-xs text-ink-500 dark:text-ink-400 mt-0.5 font-mono">
        {sizeKB} KB
      </p>
    </dd>

    <!-- Cuadro -->
    <dt class="text-ink-500 dark:text-ink-400 font-medium pt-0.5">
      {t('firmar.step6.box_section')}
    </dt>
    <dd class="text-ink-800 dark:text-ink-100 font-mono text-xs">
      {boxValue}
    </dd>

    <!-- Firmante -->
    <dt class="text-ink-500 dark:text-ink-400 font-medium pt-0.5">
      {t('firmar.step6.signer_section')}
    </dt>
    <dd class="text-ink-800 dark:text-ink-100 min-w-0">
      <p class="truncate font-medium">{signerCN}</p>
      <p class="text-xs text-ink-500 dark:text-ink-400 mt-0.5">
        {dateFmt}
      </p>
    </dd>

    <!-- Detalles -->
    <dt class="text-ink-500 dark:text-ink-400 font-medium pt-0.5">
      {t('firmar.step6.attrs_section')}
    </dt>
    <dd class="text-ink-800 dark:text-ink-100">
      {#if razon || lugar}
        <ul class="space-y-1">
          {#if razon}
            <li class="flex gap-2">
              <span class="text-ink-500 dark:text-ink-400 text-xs uppercase tracking-wide font-mono">
                {t('firmar.step5.reason_label')}:
              </span>
              <span class="break-words">{razon}</span>
            </li>
          {:else}
            <li class="text-ink-400 dark:text-ink-500 text-xs italic">
              {t('firmar.step6.attrs_no_reason')}
            </li>
          {/if}
          {#if lugar}
            <li class="flex gap-2">
              <span class="text-ink-500 dark:text-ink-400 text-xs uppercase tracking-wide font-mono">
                {t('firmar.step5.location_label')}:
              </span>
              <span class="break-words">{lugar}</span>
            </li>
          {:else}
            <li class="text-ink-400 dark:text-ink-500 text-xs italic">
              {t('firmar.step6.attrs_no_location')}
            </li>
          {/if}
        </ul>
      {:else}
        <span class="text-ink-400 dark:text-ink-500 text-xs italic">
          {t('firmar.step6.attrs_no_reason')} · {t('firmar.step6.attrs_no_location')}
        </span>
      {/if}
    </dd>
  </dl>
</section>
