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
import { type UIKey, t } from '../lib/i18n.svelte.ts';

interface Props {
  /** Most recent stage emitted by the worker. */
  stage?: string | undefined;
}

const { stage }: Props = $props();

// Breadcrumb pipeline — aligned to the phases the verify worker actually emits
// (`cms · integrity · tsa · chain · ocsp · ltv`). LTV is the long, CRL-heavy
// last step where mobile verification spends most of its time.
const STEPS = ['cms', 'integrity', 'tsa', 'chain', 'ocsp', 'ltv'] as const;

// Phases that have a `progress.<phase>` i18n key. Anything outside this set
// falls back to a generic label instead of leaking the raw key to the UI
// (the verifier beacon `verify:#0 ltv` used to render literally on screen).
const KNOWN_PHASES = new Set<string>([
  'parse',
  'scan',
  'cms',
  'integrity',
  'sig',
  'tsa',
  'path',
  'chain',
  'ocsp',
  'ltv',
  'verify',
]);

/**
 * The verify worker emits beacons shaped `verify:${tag}${name}`, where `tag` is
 * `#<sigIndex> ` for multi-firma PDFs (e.g. `verify:#0 ltv`, `verify:cms`,
 * `verify:scan`). Strip the `verify:` prefix and the `#N ` tag to the bare
 * phase token.
 */
function phaseOf(raw?: string): string {
  if (!raw) return 'parse';
  const bare = raw
    .replace(/^verify:/, '')
    .replace(/^#\d+\s*/, '')
    .trim();
  return bare || 'verify';
}

const phase = $derived(phaseOf(stage));

/** 0-based signature index when present in a multi-firma beacon, else null. */
const sigIndex = $derived.by((): number | null => {
  const m = stage?.match(/#(\d+)/);
  return m ? Number(m[1]) : null;
});

// Map current phase to the "in flight" breadcrumb position.
const activeIndex = $derived.by((): number => {
  const idx = (STEPS as readonly string[]).indexOf(phase);
  return idx >= 0 ? idx : 0;
});

const activeLabel = $derived.by((): string => {
  const key = (KNOWN_PHASES.has(phase) ? `progress.${phase}` : 'progress.verify') as UIKey;
  const label = t(key);
  return sigIndex !== null ? `${label} (firma ${sigIndex + 1})` : label;
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
