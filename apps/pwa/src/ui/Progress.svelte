<script lang="ts">
  /**
   * Progress.svelte — indeterminate progress while the verify worker runs.
   *
   * Stages emitted by the worker (best-effort coarse labels):
   *   'parse' | 'cms' | 'integrity' | 'sig' | 'path' | 'ocsp' | 'verify'
   *
   * Visual: lucide loader spinner + brand glow + the localized label of the
   * latest stage. Surrounding stage list rendered as breadcrumb dots so the
   * user can see the pipeline sequence even if intermediate stages are skipped.
   */
  import { t, type UIKey } from '../lib/i18n.svelte.ts';

  interface Props {
    /** Most recent stage emitted by the worker. */
    stage?: string | undefined;
  }

  const { stage }: Props = $props();

  const STEPS = ['parse', 'cms', 'integrity', 'sig', 'path', 'ocsp'] as const;
  type Step = (typeof STEPS)[number];

  function stepKey(s: Step): UIKey {
    return `progress.${s}` satisfies `progress.${Step}`;
  }

  // Map verify-meta stage to the "in flight" subset (everything past parse).
  const activeIndex = $derived.by((): number => {
    if (!stage) return 0;
    if (stage === 'verify') return 1; // generic verify means past parse
    const idx = (STEPS as readonly string[]).indexOf(stage);
    return idx >= 0 ? idx : 0;
  });

  const activeLabel = $derived.by((): string => {
    if (!stage) return t('progress.parse');
    if (stage === 'verify') return t('progress.verify');
    const k = `progress.${stage}` as UIKey;
    return t(k);
  });
</script>

<section
  role="status"
  aria-live="polite"
  aria-busy="true"
  class="w-full rounded-2xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 px-7 py-8 flex flex-col items-center gap-5"
>
  <div class="relative w-14 h-14 flex items-center justify-center">
    <span
      class="absolute inset-0 rounded-full bg-brand-500/15 blur-md animate-pulse"
      aria-hidden="true"
    ></span>
    <span
      class="i-lucide-loader-2 text-3xl text-brand-500 animate-spin"
      aria-hidden="true"
    ></span>
  </div>

  <p class="text-base font-medium text-ink-700 dark:text-ink-100 text-center">
    {activeLabel}
  </p>

  <ol class="flex items-center gap-2 flex-wrap justify-center" aria-hidden="true">
    {#each STEPS as s, i (s)}
      {@const isPast = i < activeIndex}
      {@const isActive = i === activeIndex}
      <li class="flex items-center gap-2">
        <span
          class="block w-2 h-2 rounded-full transition-colors duration-200"
          class:bg-brand-500={isActive}
          class:bg-brand-400={isPast}
          class:bg-ink-300={!isActive && !isPast}
          class:dark:bg-ink-700={!isActive && !isPast}
          class:animate-pulse={isActive}
        ></span>
        {#if i < STEPS.length - 1}
          <span class="block w-6 h-px bg-ink-200 dark:bg-ink-800"></span>
        {/if}
      </li>
    {/each}
  </ol>

  <p class="text-xs text-ink-500 font-mono">
    {t('verificar.processing')}
  </p>
</section>
