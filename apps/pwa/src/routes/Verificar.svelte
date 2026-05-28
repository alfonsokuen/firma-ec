<script lang="ts">
import type { MultiVerificationResult, VerificationResult } from '@firma-ec/verifier';
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
import { type UIKey, getLang, t } from '../lib/i18n.svelte.ts';
import { readQrHashFromLocation } from '../lib/qrDeepLink.ts';
import { consume as consumeIncomingPdf } from '../lib/sharedFile.ts';
import { pingUsage } from '../lib/statsBeacon.ts';
import { WorkerVerificationError, runVerifyAll } from '../lib/workers/bus';
import Detail from '../ui/Detail.svelte';
import Drop from '../ui/Drop.svelte';
import Progress from '../ui/Progress.svelte';
import Result from '../ui/Result.svelte';
import LtvBadge from '../ui/firma/LtvBadge.svelte';
import TimestampBadge from '../ui/firma/TimestampBadge.svelte';

type Phase = 'idle' | 'running' | 'done' | 'error';

type ErrorState =
  | {
      kind: 'pick';
      key: 'verificar.error_too_large' | 'verificar.error_not_pdf' | 'verificar.error_read';
    }
  | { kind: 'engine'; code: string; message: string };

let phase = $state<Phase>('idle');
let stage = $state<string | undefined>(undefined);
// v0.7.1 multi-firma: store the aggregate result. The legacy `result` field
// (used by the rest of the template + child components) is derived from the
// first signature so single-sig PDFs render unchanged. Multi-sig adds a
// summary banner + iterates signatures[N].
let multiResult = $state<MultiVerificationResult | null>(null);
// v0.7.2 — index of the currently-selected signature in the multi-firma list.
// The Result/Detail panels below render this one. Defaults to 0 (first sig)
// and resets on every new verification.
let selectedIndex = $state(0);
const result = $derived<VerificationResult | null>(
  multiResult?.signatures[selectedIndex] ?? multiResult?.signatures[0] ?? null,
);
let error = $state<ErrorState | null>(null);

// F6.1 — QR deep-link context. `qrHash` is read once on mount from `?h=<hex>`
// (null if absent/malformed). It is used ONLY to show a contextual banner
// telling the user they arrived from a firmar.ec QR and must upload the PDF to
// validate it. We deliberately do NOT compare the hash: the QR encodes the
// hash of the *unsigned* source PDF, so it never matches the signed PDF a user
// actually has — surfacing that mismatch read as a failure (see CHANGELOG
// 0.9.7). Verification is the cryptographic verdict from the worker, full stop.
let qrHash = $state<string | null>(null);

/**
 * Map a verifier engine error code to a user-friendly i18n key. Unknown codes
 * fall back to a generic message; the technical detail (code + raw message)
 * is exposed inside a `<details>` for advanced users.
 */
function engineErrorKey(
  code: string,
):
  | 'error.engine_PARSE_ERROR'
  | 'error.engine_INVALID_PDF'
  | 'error.engine_NO_SIGNATURE_FIELD'
  | 'error.engine_TIMEOUT'
  | 'error.engine_UNKNOWN' {
  switch (code) {
    case 'PARSE_ERROR':
    case 'PDF_PARSE_ERROR':
      return 'error.engine_PARSE_ERROR';
    case 'INVALID_PDF':
      return 'error.engine_INVALID_PDF';
    case 'NO_SIGNATURE_FIELD':
      return 'error.engine_NO_SIGNATURE_FIELD';
    case 'TIMEOUT':
    case 'timeout':
    case 'worker_error':
      return 'error.engine_TIMEOUT';
    default:
      return 'error.engine_UNKNOWN';
  }
}

async function runOnBuffer(buf: ArrayBuffer): Promise<void> {
  error = null;
  multiResult = null;
  selectedIndex = 0;
  stage = undefined;
  phase = 'running';
  try {
    const r = await runVerifyAll(buf, {
      onProgress: (s) => {
        stage = s;
      },
    });
    multiResult = r;
    phase = 'done';
    // Count only verifications that actually inspected signatures (a signed
    // PDF was checked), not empty/unsigned drops. Anonymous, no PII / content.
    if (r.signatureCount > 0) pingUsage('verify');
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

function onError(
  key: 'verificar.error_too_large' | 'verificar.error_not_pdf' | 'verificar.error_read',
): void {
  error = { kind: 'pick', key };
  phase = 'error';
}

function reset(): void {
  phase = 'idle';
  stage = undefined;
  multiResult = null;
  selectedIndex = 0;
  error = null;
  // Keep `qrHash` — the user may want to drop another PDF and still see the
  // QR context banner until they navigate away.
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
          {t('verificar.qr.banner_subtitle')}
        </p>
      </div>
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
  {:else if phase === 'done' && multiResult && multiResult.signatureCount === 0}
    <!-- v0.7.35 — explicit no-signature state. Previously the done branch
         required a non-null `result` (derived from signatures[0]); a PDF with
         zero signatures rendered a BLANK screen ("se queda vacío"). -->
    <div class="flex flex-col gap-6">
      <aside
        role="status"
        class="rounded-2xl border border-ink-300/50 dark:border-ink-700/60 bg-ink-100/60 dark:bg-ink-900/40 px-7 py-6 flex items-start gap-3"
      >
        <span class="i-lucide-file-x text-2xl text-ink-500 shrink-0 mt-0.5" aria-hidden="true"></span>
        <div class="flex-1 min-w-0">
          <h2 class="font-display font-semibold text-ink-800 dark:text-ink-100 mb-1">
            {t('verificar.no_signature')}
          </h2>
          <p class="text-sm text-ink-600 dark:text-ink-300">
            {t('verificar.no_signature_summary')}
          </p>
        </div>
      </aside>
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
  {:else if phase === 'done' && result && multiResult}
    <div class="flex flex-col gap-6">
      <!-- v0.7.1 multi-firma: summary banner when the PDF has > 1 signature.
           Listed in chronological/document order. Each entry shows signer CN
           + per-signature status badge. Click expands to that signer's detail
           (DSS/timestamp/integrity) inline. -->
      <!-- v0.7.20: status card (Result) renders ABOVE the multi-firmas list per
           user request 2026-05-15 — the per-firma status is the more important
           card for the active selection. -->
      <Result {result} />

      {#if multiResult.signatureCount > 1}
        {@const overall = multiResult.overallStatus}
        {@const overallColor =
          overall === 'valid'
            ? 'border-ok-500/40 bg-ok-500/10'
            : overall === 'warning'
              ? 'border-warn-500/40 bg-warn-500/10'
              : 'border-err-500/40 bg-err-500/10'}
        {@const overallIcon =
          overall === 'valid'
            ? 'i-lucide-shield-check text-ok-500'
            : overall === 'warning'
              ? 'i-lucide-shield-alert text-warn-500'
              : 'i-lucide-shield-x text-err-500'}
        <aside
          role="status"
          class="rounded-2xl border px-6 py-5 {overallColor} flex flex-col gap-4"
        >
          <div class="flex items-start gap-3">
            <span class="{overallIcon} text-2xl shrink-0 mt-0.5" aria-hidden="true"></span>
            <div class="flex-1 min-w-0">
              <h2 class="font-display font-semibold text-lg">
                {multiResult.signatureCount} firmas detectadas
              </h2>
              <p class="text-sm text-ink-700 dark:text-ink-200 mt-1">
                {#if overall === 'valid'}
                  Todas las firmas son criptográficamente válidas.
                {:else if overall === 'warning'}
                  Todas válidas pero al menos una con advertencias — revisa el
                  detalle por firmante.
                {:else}
                  Al menos una firma falló la verificación — revisa cuál.
                {/if}
              </p>
            </div>
          </div>
          <ol class="flex flex-col gap-2 pl-1" aria-label="Firmantes detectados">
            {#each multiResult.signatures as sig, i}
              {@const sigColor =
                sig.status === 'valid'
                  ? 'text-ok-600 dark:text-ok-400'
                  : sig.status === 'warning'
                    ? 'text-warn-600 dark:text-warn-400'
                    : 'text-err-600 dark:text-err-400'}
              {@const sigIcon =
                sig.status === 'valid'
                  ? 'i-lucide-check-circle-2'
                  : sig.status === 'warning'
                    ? 'i-lucide-alert-triangle'
                    : 'i-lucide-x-circle'}
              {@const isSelected = i === selectedIndex}
              <li>
                <button
                  type="button"
                  onclick={() => (selectedIndex = i)}
                  aria-pressed={isSelected}
                  class="w-full flex items-center gap-3 text-sm text-left rounded-md px-2 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950 {isSelected
                    ? 'bg-brand-500/15 ring-1 ring-brand-500/40'
                    : 'hover:bg-ink-500/5 dark:hover:bg-ink-100/5'}"
                >
                  <span class="font-mono text-xs text-ink-500 w-6 shrink-0">#{i + 1}</span>
                  <span class="{sigIcon} text-base {sigColor} shrink-0" aria-hidden="true"></span>
                  <span class="flex-1 min-w-0 truncate">
                    <span class="font-medium text-ink-800 dark:text-ink-100">
                      {sig.signer?.cert?.subject?.cn ?? '(firmante sin CN)'}
                    </span>
                    {#if sig.signature?.signingTime}
                      <span class="text-ink-500 ml-2">
                        · {new Intl.DateTimeFormat(getLang() === 'es' ? 'es-EC' : 'en-US', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        }).format(new Date(sig.signature.signingTime))}
                      </span>
                    {/if}
                    {#if sig.signature?.profile}
                      <span class="text-ink-500 ml-2 font-mono text-xs">{sig.signature.profile}</span>
                    {/if}
                  </span>
                  {#if isSelected}
                    <span class="i-lucide-eye text-base text-brand-600 dark:text-brand-400 shrink-0" aria-label="Firma seleccionada"></span>
                  {/if}
                </button>
              </li>
            {/each}
          </ol>
          <p class="text-xs text-ink-500 italic">
            Toca un firmante para inspeccionar su detalle técnico abajo. Actualmente
            viendo firma <span class="font-mono">#{selectedIndex + 1}</span> de
            <span class="font-mono">{multiResult.signatureCount}</span>.
          </p>
        </aside>
      {/if}

      {#if result.signature?.timestamp && result.signature.timestamp.badge !== 'none'}
        <TimestampBadge
          badge={result.signature.timestamp.badge}
          context="verificar"
          signingTime={result.signature.timestamp.signingTime}
          tsaIssuer={result.signature.timestamp.tsaIssuer}
          reason={result.signature.timestamp.reason}
        />
      {/if}
      <!-- F7 §T30 — LtvBadge below the TimestampBadge. Renders only B-LT/B-LTA. -->
      {#if result.signature?.ltv}
        <LtvBadge ltv={result.signature.ltv} />
      {/if}
      <!-- F7 §T30 — Detalle técnico: DSS · Validación a largo plazo -->
      {#if result.signature?.ltv && (result.signature.ltv.dssPresent || result.signature.ltv.profile === 'B-LTA')}
        {@const ltv = result.signature.ltv}
        <details
          class="rounded-2xl border border-ink-200 dark:border-ink-800 bg-ink-50/40 dark:bg-ink-900/30 px-5 py-4"
        >
          <summary class="cursor-pointer font-display font-semibold text-sm select-none flex items-center gap-2">
            <span class="i-lucide-archive-restore text-base text-brand-500" aria-hidden="true"></span>
            {t('ltv.detail.section_title')}
          </summary>
          <dl class="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs font-mono">
            <dt class="text-ink-500">{t('ltv.detail.dss_present')}</dt>
            <dd>{ltv.dssPresent ? t('ltv.detail.dss_present') : t('ltv.detail.dss_absent')}</dd>
            <dt class="text-ink-500">{t('ltv.detail.embedded_ocsp')}</dt>
            <dd>{ltv.embeddedOcspCount}</dd>
            <dt class="text-ink-500">{t('ltv.detail.embedded_crl')}</dt>
            <dd>{ltv.embeddedCrlCount}</dd>
            <dt class="text-ink-500">{t('ltv.detail.retrospective_valid')}</dt>
            <dd>{ltv.retrospectiveValid ? t('ltv.detail.retrospective_yes') : t('ltv.detail.retrospective_no')}</dd>
            <dt class="text-ink-500">{t('ltv.detail.archive_ts')}</dt>
            <dd>
              {#if ltv.documentTimestamp?.valid && ltv.documentTimestamp.signingTime}
                {new Intl.DateTimeFormat(getLang() === 'es' ? 'es-EC' : 'en-US', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(ltv.documentTimestamp.signingTime))}
              {:else}
                {t('ltv.detail.archive_none')}
              {/if}
            </dd>
          </dl>
        </details>
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
