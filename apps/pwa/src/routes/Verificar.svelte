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
  import { onMount } from 'svelte';
  import type { VerificationResult } from '@firma-ec/verifier';
  import { runVerify, WorkerVerificationError } from '../lib/workers/bus';
  import { t, tp, type UIKey } from '../lib/i18n.svelte.ts';
  import { consume as consumeIncomingPdf } from '../lib/sharedFile.ts';
  import { readQrHashFromLocation, compareHash12 } from '../lib/qrDeepLink.ts';
  import Drop from '../ui/Drop.svelte';
  import Progress from '../ui/Progress.svelte';
  import Result from '../ui/Result.svelte';
  import Detail from '../ui/Detail.svelte';
  import TimestampBadge from '../ui/firma/TimestampBadge.svelte';

  type Phase = 'idle' | 'running' | 'done' | 'error';

  type ErrorState =
    | { kind: 'pick'; key: 'verificar.error_too_large' | 'verificar.error_not_pdf' | 'verificar.error_read' }
    | { kind: 'engine'; code: string; message: string };

  let phase = $state<Phase>('idle');
  let stage = $state<string | undefined>(undefined);
  let result = $state<VerificationResult | null>(null);
  let error = $state<ErrorState | null>(null);
  let demoBannerDismissed = $state(false);

  // F6.1 — QR deep-link verification. `qrHash` is read once on mount from
  // `?h=<hex>` (set null thereafter if absent/malformed). After the user drops
  // a PDF we compute SHA-256 of the uploaded bytes (first 12 hex) and compare;
  // result is purely informational — the cryptographic verdict from the
  // verifier worker is the source of truth.
  let qrHash = $state<string | null>(null);
  let qrCompare = $state<{ match: boolean; computed: string } | null>(null);

  /**
   * Demo banner appears whenever the verifier flags the trust chain as
   * provisional. We accept several signals from the verifier to remain robust
   * across releases:
   *   - explicit warning code TSL_PROVISIONAL or TRUST_PLACEHOLDER
   *   - any warning whose message contains "placeholder" or "provisional"
   * The first matching condition wins. TODO(verifier): expose a stable boolean
   * `result.trustChain.binding === 'provisional'` so this heuristic can be
   * dropped in v0.3.0.
   */
  const showDemoBanner = $derived.by((): boolean => {
    if (demoBannerDismissed) return false;
    if (!result) return false;
    return result.warnings.some(
      (w) =>
        w.code === 'TSL_PROVISIONAL' ||
        w.code === 'TRUST_PLACEHOLDER' ||
        /placeholder|provisional/i.test(w.message),
    );
  });

  /**
   * Map a verifier engine error code to a user-friendly i18n key. Unknown codes
   * fall back to a generic message; the technical detail (code + raw message)
   * is exposed inside a `<details>` for advanced users.
   */
  function engineErrorKey(
    code: string,
  ): 'error.engine_PARSE_ERROR' | 'error.engine_INVALID_PDF' | 'error.engine_NO_SIGNATURE_FIELD' | 'error.engine_TIMEOUT' | 'error.engine_UNKNOWN' {
    switch (code) {
      case 'PARSE_ERROR':
      case 'PDF_PARSE_ERROR':
        return 'error.engine_PARSE_ERROR';
      case 'INVALID_PDF':
        return 'error.engine_INVALID_PDF';
      case 'NO_SIGNATURE_FIELD':
        return 'error.engine_NO_SIGNATURE_FIELD';
      case 'TIMEOUT':
        return 'error.engine_TIMEOUT';
      default:
        return 'error.engine_UNKNOWN';
    }
  }

  async function runOnBuffer(buf: ArrayBuffer): Promise<void> {
    error = null;
    result = null;
    stage = undefined;
    demoBannerDismissed = false;
    qrCompare = null;
    phase = 'running';
    // F6.1 — compute hash compare against the QR hint (if any) BEFORE handing
    // the buffer to the verifier worker (which may transfer / consume it).
    // Failures here are non-fatal: we just skip the badge.
    if (qrHash) {
      try {
        const snapshot = buf.slice(0) as ArrayBuffer;
        qrCompare = await compareHash12(snapshot, qrHash);
      } catch {
        qrCompare = null;
      }
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

  async function onSelect(file: File): Promise<void> {
    let buf: ArrayBuffer;
    try {
      buf = await file.arrayBuffer();
    } catch (_) {
      error = { kind: 'pick', key: 'verificar.error_read' };
      phase = 'error';
      return;
    }
    await runOnBuffer(buf);
  }

  /**
   * Decode chunked base64 stashed by DownloadResult into a Uint8Array.
   * Mirrors `uint8ToBase64` chunking strategy on the encode side.
   */
  function base64ToUint8(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /**
   * v0.4.6 — cross-route handoff sign→verify. DownloadResult writes the
   * just-signed bytes under `firmar.verify_preload.bytes_b64` and pushes
   * '/verificar'. We consume + auto-run so the user lands on the result
   * directly (status='warning' in demo mode), with no re-drop required.
   */
  function consumeVerifyHandoff(): { bytes: Uint8Array; name: string } | null {
    try {
      const b64 = sessionStorage.getItem('firmar.verify_preload.bytes_b64');
      const name = sessionStorage.getItem('firmar.verify_preload.name');
      if (!b64) return null;
      sessionStorage.removeItem('firmar.verify_preload.bytes_b64');
      sessionStorage.removeItem('firmar.verify_preload.name');
      return { bytes: base64ToUint8(b64), name: name ?? 'signed.pdf' };
    } catch {
      return null;
    }
  }

  // v0.4.0 — auto-load a PDF that arrived via OS share/file_handlers and was
  // stashed by SharedFileHandler. consume() clears the entry so a manual reload
  // doesn't re-trigger the flow with a stale payload.
  // v0.4.6 — also consume cross-route sign→verify handoff (DownloadResult).
  onMount(() => {
    // F6.1 — capture QR `?h=` hint once (router URL is hash-based).
    qrHash = readQrHashFromLocation();
    const handoff = consumeVerifyHandoff();
    if (handoff) {
      const ab = handoff.bytes.buffer.slice(
        handoff.bytes.byteOffset,
        handoff.bytes.byteOffset + handoff.bytes.byteLength,
      ) as ArrayBuffer;
      void runOnBuffer(ab);
      return;
    }
    const incoming = consumeIncomingPdf();
    if (incoming) {
      // Copy into a fresh ArrayBuffer so we don't pin the underlying SAB.
      const ab = incoming.bytes.buffer.slice(
        incoming.bytes.byteOffset,
        incoming.bytes.byteOffset + incoming.bytes.byteLength,
      ) as ArrayBuffer;
      void runOnBuffer(ab);
    }
  });

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
    qrCompare = null;
    // Keep `qrHash` — the user may want to drop another PDF and still see the
    // QR banner / compare against the same hint until they navigate away.
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

  {#if qrHash}
    <aside
      role="status"
      class="mb-4 rounded-2xl border border-brand-500/30 bg-brand-100/60 dark:bg-brand-500/10 px-6 py-4 flex items-start gap-3"
    >
      <span class="i-lucide-qr-code text-2xl text-brand-700 dark:text-brand-300 shrink-0 mt-0.5" aria-hidden="true"></span>
      <div class="flex-1 min-w-0">
        <h2 class="font-display font-semibold text-ink-700 dark:text-ink-100 mb-1">
          {t('verificar.qr.banner_title')}
        </h2>
        <p class="text-sm text-ink-700 dark:text-ink-200 break-words">
          {tp('verificar.qr.banner_subtitle', { hash: qrHash })}
        </p>
      </div>
    </aside>
  {/if}

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
        aria-label={t('verificar.dismiss_demo')}
        class="shrink-0 w-11 h-11 rounded-md flex items-center justify-center text-ink-500 hover:bg-warn-500/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
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
          {error?.kind === 'pick' ? t('error.title_pick') : t('error.title_engine')}
        </h2>
        {#if error?.kind === 'pick'}
          <p class="text-ink-700 dark:text-ink-200">{pickErrorMessage(error.key)}</p>
        {:else if error?.kind === 'engine'}
          <p class="text-ink-700 dark:text-ink-200">{t(engineErrorKey(error.code))}</p>
          <details class="mt-3 text-sm">
            <summary class="cursor-pointer text-ink-500 hover:text-ink-700 dark:hover:text-ink-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 rounded">
              {t('error.engine_show_technical')}
            </summary>
            <p class="mt-2 break-words">
              <span class="font-mono text-xs text-err-500">{error.code}</span>
              <span class="ml-2 text-ink-600 dark:text-ink-300">{error.message}</span>
            </p>
          </details>
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
      {#if result.signature?.timestamp && result.signature.timestamp.badge !== 'none'}
        <TimestampBadge
          badge={result.signature.timestamp.badge}
          context="verificar"
          signingTime={result.signature.timestamp.signingTime}
          tsaIssuer={result.signature.timestamp.tsaIssuer}
          reason={result.signature.timestamp.reason}
        />
      {/if}
      {#if qrHash && qrCompare}
        {#if qrCompare.match}
          <aside
            role="status"
            class="rounded-2xl border border-ok-500/40 bg-ok-500/10 px-6 py-4 flex items-start gap-3"
          >
            <span class="i-lucide-check-circle-2 text-2xl text-ok-500 shrink-0 mt-0.5" aria-hidden="true"></span>
            <p class="text-sm text-ink-700 dark:text-ink-200 flex-1 min-w-0">
              {t('verificar.qr.match_ok')}
            </p>
          </aside>
        {:else}
          <aside
            role="status"
            class="rounded-2xl border border-warn-500/30 bg-warn-500/5 px-6 py-4 flex items-start gap-3"
          >
            <span class="i-lucide-info text-2xl text-warn-500 shrink-0 mt-0.5" aria-hidden="true"></span>
            <div class="flex-1 min-w-0">
              <p class="text-sm text-ink-700 dark:text-ink-200">
                {t('verificar.qr.match_warn')}
              </p>
              <details class="mt-2 text-sm">
                <summary class="cursor-pointer text-ink-500 hover:text-ink-700 dark:hover:text-ink-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 rounded">
                  {t('verificar.qr.why_summary')}
                </summary>
                <p class="mt-2 text-ink-600 dark:text-ink-300">
                  {t('verificar.qr.why_body')}
                </p>
              </details>
            </div>
          </aside>
        {/if}
      {/if}
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
