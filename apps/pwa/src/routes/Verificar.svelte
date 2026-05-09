<script lang="ts">
  /**
   * Verificar.svelte — main verification flow.
   *
   * Pipeline: Drop → runVerify (single-shot worker) → Progress → Result + Detail.
   *
   * Demo banner: shown prominently while ARCOTEL TSL roots are placeholders
   * (heuristic: any warning whose message includes "placeholder"). Banner is
   * dismissible per-session but redrawn for each new verification.
   */
  import type { VerificationResult } from '@firma-ec/verifier';
  import { runVerify, WorkerVerificationError } from '../lib/workers/bus';
  import { t, type UIKey } from '../lib/i18n.svelte.ts';
  import Drop from '../ui/Drop.svelte';
  import Progress from '../ui/Progress.svelte';
  import Result from '../ui/Result.svelte';
  import Detail from '../ui/Detail.svelte';

  type Phase = 'idle' | 'running' | 'done' | 'error';

  type ErrorState =
    | { kind: 'pick'; key: 'verificar.error_too_large' | 'verificar.error_not_pdf' | 'verificar.error_read' }
    | { kind: 'engine'; code: string; message: string };

  let phase = $state<Phase>('idle');
  let stage = $state<string | undefined>(undefined);
  let result = $state<VerificationResult | null>(null);
  let error = $state<ErrorState | null>(null);
  let demoBannerDismissed = $state(false);

  const showDemoBanner = $derived.by((): boolean => {
    if (demoBannerDismissed) return false;
    if (!result) return false;
    return result.warnings.some((w) => /placeholder/i.test(w.message));
  });

  async function onSelect(file: File): Promise<void> {
    error = null;
    result = null;
    stage = undefined;
    demoBannerDismissed = false;
    phase = 'running';

    let buf: ArrayBuffer;
    try {
      buf = await file.arrayBuffer();
    } catch (e) {
      error = { kind: 'pick', key: 'verificar.error_read' };
      phase = 'error';
      return;
    }

    try {
      const r = await runVerify(buf, {
        onProgress: (s) => {
          stage = s;
        },
      });
      result = r;
      phase = 'done';
    } catch (e) {
      if (e instanceof WorkerVerificationError) {
        error = { kind: 'engine', code: e.code, message: e.message };
      } else {
        error = { kind: 'engine', code: 'unknown', message: (e as Error).message };
      }
      phase = 'error';
    }
  }

  function onError(key: 'verificar.error_too_large' | 'verificar.error_not_pdf' | 'verificar.error_read'): void {
    error = { kind: 'pick', key };
    phase = 'error';
  }

  function reset(): void {
    phase = 'idle';
    stage = undefined;
    result = null;
    error = null;
    demoBannerDismissed = false;
  }

  type PickErrorKey = Extract<ErrorState, { kind: 'pick' }>['key'];

  function pickErrorMessage(key: PickErrorKey): string {
    return t(key);
  }
</script>

<section class="container max-w-3xl mx-auto px-4 py-12 md:py-16">
  <header class="mb-8">
    <h1 class="text-3xl md:text-4xl font-display font-bold tracking-tight mb-2">
      {t('verificar.title')}
    </h1>
    <p class="text-ink-500 text-base md:text-lg">
      {t('verificar.subtitle')}
    </p>
  </header>

  {#if showDemoBanner}
    <aside
      role="status"
      class="mb-8 rounded-2xl border border-warn-500/40 bg-warn-500/10 px-7 py-5 flex items-start gap-3"
    >
      <span class="i-lucide-shield-alert text-2xl text-warn-500 shrink-0 mt-0.5" aria-hidden="true"></span>
      <div class="flex-1 min-w-0">
        <h2 class="font-display font-semibold text-warn-500 mb-1">
          {t('verificar.demo_banner_title')}
        </h2>
        <p class="text-sm text-ink-700 dark:text-ink-200">
          {t('verificar.demo_banner_body')}
        </p>
      </div>
      <button
        type="button"
        onclick={() => (demoBannerDismissed = true)}
        aria-label="✕"
        class="shrink-0 w-10 h-10 rounded-md flex items-center justify-center text-ink-500 hover:bg-warn-500/10 transition-colors"
      >
        <span class="i-lucide-x text-base" aria-hidden="true"></span>
      </button>
    </aside>
  {/if}

  {#if phase === 'idle'}
    <Drop onselect={onSelect} onerror={onError} />
  {:else if phase === 'running'}
    <Progress {stage} />
  {:else if phase === 'error'}
    <div role="alert" class="rounded-2xl border border-err-500/40 bg-err-500/10 px-7 py-6 flex items-start gap-3">
      <span class="i-lucide-x-circle text-2xl text-err-500 shrink-0 mt-0.5" aria-hidden="true"></span>
      <div class="flex-1 min-w-0">
        <h2 class="font-display font-semibold text-err-500 mb-1">
          {t('verificar.error_title')}
        </h2>
        {#if error?.kind === 'pick'}
          <p class="text-ink-700 dark:text-ink-200">{pickErrorMessage(error.key)}</p>
        {:else if error?.kind === 'engine'}
          <p class="text-ink-700 dark:text-ink-200 break-words">
            <span class="font-mono text-xs text-err-500">{error.code}</span>
            <span class="ml-2">{error.message}</span>
          </p>
        {/if}
        <button
          type="button"
          onclick={reset}
          class="mt-4 inline-flex items-center gap-2 h-11 px-5 rounded-md bg-brand-500 text-white font-medium hover:bg-brand-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
        >
          <span class="i-lucide-rotate-ccw text-base" aria-hidden="true"></span>
          {t('verificar.reset')}
        </button>
      </div>
    </div>
  {:else if phase === 'done' && result}
    <div class="flex flex-col gap-6">
      <Result {result} />
      <Detail {result} />
      <div class="flex justify-center">
        <button
          type="button"
          onclick={reset}
          class="inline-flex items-center gap-2 h-11 px-5 rounded-md border border-ink-300 dark:border-ink-700 bg-ink-50 dark:bg-ink-900 hover:bg-ink-100 dark:hover:bg-ink-800 text-ink-700 dark:text-ink-100 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
        >
          <span class="i-lucide-rotate-ccw text-base" aria-hidden="true"></span>
          {t('verificar.reset')}
        </button>
      </div>
    </div>
  {/if}
</section>
