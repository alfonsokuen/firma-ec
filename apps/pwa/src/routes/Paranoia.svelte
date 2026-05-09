<script lang="ts">
  /**
   * Paranoia.svelte — advanced technical view.
   *
   * Dumps the full {@link VerificationResult} structure (the worker contract) and
   * surfaces every primitive value the verifier returns. Raw CMS bytes / cert
   * chain PEMs / signedAttrs hex / OCSP DER are not exposed by the current
   * verifier API (extracting them requires a v0.2.0 enhanced result type — see
   * docs/superpowers/plans). Until then this view shows the complete decoded
   * result + bundle hash + per-section copy buttons for technical users.
   */
  import type { VerificationResult } from '@firma-ec/verifier';
  import { runVerify, WorkerVerificationError } from '../lib/workers/bus';
  import { t } from '../lib/i18n.svelte.ts';
  import Drop from '../ui/Drop.svelte';
  import Progress from '../ui/Progress.svelte';
  import BundleHashBadge from '../ui/BundleHashBadge.svelte';

  type Phase = 'idle' | 'running' | 'done' | 'error';

  let phase = $state<Phase>('idle');
  let stage = $state<string | undefined>(undefined);
  let result = $state<VerificationResult | null>(null);
  let errorMsg = $state<string | null>(null);
  let copiedKey = $state<string | null>(null);

  async function onSelect(file: File): Promise<void> {
    errorMsg = null;
    result = null;
    stage = undefined;
    phase = 'running';

    let buf: ArrayBuffer;
    try {
      buf = await file.arrayBuffer();
    } catch (e) {
      errorMsg = (e as Error).message;
      phase = 'error';
      return;
    }

    try {
      const r = await runVerify(buf, { onProgress: (s) => (stage = s) });
      result = r;
      phase = 'done';
    } catch (e) {
      errorMsg = e instanceof WorkerVerificationError ? `${e.code}: ${e.message}` : (e as Error).message;
      phase = 'error';
    }
  }

  function onError(key: 'verificar.error_too_large' | 'verificar.error_not_pdf' | 'verificar.error_read'): void {
    errorMsg = t(key);
    phase = 'error';
  }

  function reset(): void {
    phase = 'idle';
    stage = undefined;
    result = null;
    errorMsg = null;
  }

  async function copySection(key: string, payload: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(payload);
      copiedKey = key;
      setTimeout(() => {
        if (copiedKey === key) copiedKey = null;
      }, 1500);
    } catch (_) {
      /* clipboard API unavailable — silent */
    }
  }

  const cmsDump = $derived.by((): string => {
    if (!result) return '';
    return JSON.stringify(
      {
        signature: result.signature,
        signer: result.signer,
        integrity: result.integrity,
      },
      null,
      2,
    );
  });

  const chainDump = $derived.by((): string => {
    if (!result?.signer) return '';
    return JSON.stringify(
      {
        subject: result.signer.cert.subject,
        issuer: result.signer.cert.issuer,
        serialNumberHex: result.signer.cert.serialNumberHex,
        validFrom: result.signer.cert.validFrom,
        validUntil: result.signer.cert.validUntil,
        fingerprintSha256: result.signer.cert.fingerprintSha256,
        matchedRoot: { slug: result.signer.matchedRootSlug, name: result.signer.matchedRootName },
      },
      null,
      2,
    );
  });

  const ocspDump = $derived.by((): string => {
    if (!result?.ocsp) return '';
    return JSON.stringify(result.ocsp, null, 2);
  });

  const summaryDump = $derived.by((): string => {
    if (!result) return '';
    return JSON.stringify(
      {
        status: result.status,
        engineVersion: result.engineVersion,
        verifiedAt: result.verifiedAt,
        warningsCount: result.warnings.length,
      },
      null,
      2,
    );
  });
</script>

<section class="container max-w-4xl mx-auto px-4 py-12 md:py-16">
  <header class="mb-8">
    <h1 class="text-3xl md:text-4xl font-display font-bold tracking-tight mb-2">
      {t('paranoia.title')}
    </h1>
    <p class="text-ink-500 text-base md:text-lg">
      {t('paranoia.description')}
    </p>
  </header>

  <aside
    role="status"
    class="mb-8 rounded-2xl border border-warn-500/40 bg-warn-500/10 px-7 py-5 flex items-start gap-3"
  >
    <span class="i-lucide-shield-alert text-2xl text-warn-500 shrink-0 mt-0.5" aria-hidden="true"></span>
    <p class="text-sm text-ink-700 dark:text-ink-200">
      {t('paranoia.advanced_warning')}
    </p>
  </aside>

  <div class="mb-8 flex items-center gap-3 rounded-xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 px-5 py-3">
    <span class="i-lucide-shield-check text-xl text-brand-500" aria-hidden="true"></span>
    <div class="flex-1 min-w-0">
      <p class="text-xs uppercase tracking-wide text-ink-500">{t('paranoia.bundle_hash')}</p>
      <BundleHashBadge />
    </div>
  </div>

  {#if phase === 'idle'}
    <p class="text-sm text-ink-500 mb-3">{t('paranoia.dropzone_hint')}</p>
    <Drop onselect={onSelect} onerror={onError} />
  {:else if phase === 'running'}
    <Progress {stage} />
  {:else if phase === 'error'}
    <div role="alert" class="rounded-2xl border border-err-500/40 bg-err-500/10 px-7 py-6">
      <h2 class="font-display font-semibold text-err-500 mb-2">
        {t('verificar.error_title')}
      </h2>
      <p class="font-mono text-sm text-ink-700 dark:text-ink-200 break-all">{errorMsg}</p>
      <button
        type="button"
        onclick={reset}
        class="mt-4 inline-flex items-center gap-2 h-11 px-5 rounded-md bg-brand-500 text-white font-medium hover:bg-brand-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        <span class="i-lucide-rotate-ccw text-base" aria-hidden="true"></span>
        {t('verificar.reset')}
      </button>
    </div>
  {:else if phase === 'done' && result}
    <div class="flex flex-col gap-6">

      {#each [{ key: 'summary', titleKey: 'paranoia.section_summary', payload: summaryDump }, { key: 'cms', titleKey: 'paranoia.section_cms', payload: cmsDump }, { key: 'chain', titleKey: 'paranoia.section_chain', payload: chainDump }, { key: 'ocsp', titleKey: 'paranoia.section_ocsp', payload: ocspDump }] as section (section.key)}
        <details open={section.key === 'summary'} class="group rounded-2xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 overflow-hidden">
          <summary
            class="
              list-none cursor-pointer select-none px-7 py-4 min-h-12
              flex items-center justify-between gap-4
              text-base font-medium text-ink-700 dark:text-ink-100
              hover:bg-ink-100 dark:hover:bg-ink-800/60 transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2
            "
          >
            <span class="flex items-center gap-2">
              <span class="i-lucide-file-text text-base text-brand-500" aria-hidden="true"></span>
              {t(section.titleKey as Parameters<typeof t>[0])}
            </span>
            <span class="i-lucide-chevron-down text-base text-ink-500 transition-transform group-open:rotate-180" aria-hidden="true"></span>
          </summary>
          <div class="px-7 py-5 border-t border-ink-200 dark:border-ink-800">
            {#if section.payload}
              <div class="flex justify-end mb-2">
                <button
                  type="button"
                  onclick={() => copySection(section.key, section.payload)}
                  class="inline-flex items-center gap-2 h-9 px-3 rounded-md text-xs font-medium border border-ink-200 dark:border-ink-700 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  aria-label={t('paranoia.copy')}
                >
                  {#if copiedKey === section.key}
                    <span class="i-lucide-check text-sm text-ok-500" aria-hidden="true"></span>
                    {t('paranoia.copied')}
                  {:else}
                    <span class="i-lucide-copy text-sm" aria-hidden="true"></span>
                    {t('paranoia.copy')}
                  {/if}
                </button>
              </div>
              <pre class="text-xs font-mono text-ink-700 dark:text-ink-100 whitespace-pre-wrap break-all overflow-x-auto rounded-lg bg-ink-100 dark:bg-ink-950 p-4 max-h-96">{section.payload}</pre>
            {:else}
              <p class="text-sm text-ink-500 italic">{t('paranoia.empty')}</p>
            {/if}
          </div>
        </details>
      {/each}

      <div class="flex justify-center pt-4">
        <button
          type="button"
          onclick={reset}
          class="inline-flex items-center gap-2 h-11 px-5 rounded-md border border-ink-300 dark:border-ink-700 bg-ink-50 dark:bg-ink-900 hover:bg-ink-100 dark:hover:bg-ink-800 text-ink-700 dark:text-ink-100 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <span class="i-lucide-rotate-ccw text-base" aria-hidden="true"></span>
          {t('verificar.reset')}
        </button>
      </div>
    </div>
  {/if}
</section>
