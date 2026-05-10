<script lang="ts">
  /**
   * DownloadResult.svelte — pantalla success (paso 7).
   *
   * - Auto-trigger del download al mount via <a download> programático.
   * - Filename derivation: original.pdf → original-firmado.pdf (es) / -signed.pdf (en).
   * - navigator.share feature-detect: si presente + canShare con archivos, ofrecer share.
   * - "Verificar este PDF" enlaza a /verificar pre-cargando el blob via sessionStorage.
   * - "Firmar otro PDF" llama callback que resetea state al paso 1.
   * - Cleanup: revoke object URL on destroy.
   */
  import { t, tp, getLang, type UIKey } from '../../lib/i18n.svelte.ts';
  import { onMount, onDestroy } from 'svelte';
  import { push } from 'svelte-spa-router';
  import {
    getContext as getInboxContext,
    clear as clearInboxContext,
    touch as touchInbox,
  } from '../../lib/inboxStore.ts';
  import {
    outboxSend,
    isValidEcuadorPhone,
    bytesToBase64,
    InboxApiError,
  } from '../../lib/inboxApi.ts';
  import Button from '../Button.svelte';
  import TimestampBadge from './TimestampBadge.svelte';
  import LtvBadge from './LtvBadge.svelte';
  import { ltvBadgeFromMeta } from './ltv-badge-data.js';

  import type { TimestampMeta, LtvMeta } from '../../lib/workers/sign-bus.ts';

  interface Props {
    /** Bytes del PDF firmado. */
    signedPdfBlob: Uint8Array;
    /** Filename original (incluye .pdf). */
    originalName: string;
    /** Cantidad de firmas en el PDF firmado (para size_count). */
    signatureCount?: number;
    /**
     * F6 §Task 16/18 — outcome of the RFC 3161 timestamp request. Drives
     * the TimestampBadge + fallback warning. Null when the wizard is in
     * legacy/no-TSA mode (e.g. multi-firma path which signer pins to B-B).
     */
    timestamp?: TimestampMeta | null;
    /**
     * F7 §T30 — outcome of the LTV pipeline (B-LT / B-LTA). Drives the
     * LtvBadge underneath the TimestampBadge. Null in multi-firma path
     * (signer pins ltv = ltvNotApplicable('B-B')).
     */
    ltv?: LtvMeta | null;
    /** Reset wizard al paso 1. */
    onsignagain: () => void;
  }

  const {
    signedPdfBlob,
    originalName,
    signatureCount = 1,
    timestamp = null,
    ltv = null,
    onsignagain,
  }: Props = $props();

  const ltvBadgeData = $derived.by(() => (ltv ? ltvBadgeFromMeta(ltv) : null));

  const lang = $derived(getLang());

  // Derive filename. We avoid double-suffix.
  const outName = $derived.by(() => {
    const base = originalName.replace(/\.pdf$/i, '');
    const suffix = t('firmar.step7.filename_suffix'); // "-firmado" / "-signed"
    if (base.endsWith(suffix)) {
      // Append numeric counter to avoid collisions
      return `${base}-2.pdf`;
    }
    return `${base}${suffix}.pdf`;
  });

  // Build blob + URL once (re-derive when the input changes; in practice it doesn't).
  let blobUrl = $state<string | null>(null);
  let autoDownloadFired = $state(false);

  /** Copy bytes into a fresh ArrayBuffer so TS BlobPart accepts them
   * (Uint8Array<ArrayBufferLike> may include SharedArrayBuffer). */
  function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
    const out = new ArrayBuffer(u8.byteLength);
    new Uint8Array(out).set(u8);
    return out;
  }

  onMount(() => {
    const blob = new Blob([toArrayBuffer(signedPdfBlob)], {
      type: 'application/pdf',
    });
    blobUrl = URL.createObjectURL(blob);
    // Auto-trigger download
    triggerDownload();
  });

  onDestroy(() => {
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = null;
    }
  });

  function triggerDownload(): void {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = outName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    autoDownloadFired = true;
  }

  // Feature-detect share capability
  const canShare = $derived.by(() => {
    if (typeof navigator === 'undefined') return false;
    if (!('share' in navigator) || !('canShare' in navigator)) return false;
    try {
      const file = new File([toArrayBuffer(signedPdfBlob)], outName, { type: 'application/pdf' });
      return navigator.canShare({ files: [file] });
    } catch {
      return false;
    }
  });

  async function onShare(): Promise<void> {
    if (!canShare) return;
    try {
      const file = new File([toArrayBuffer(signedPdfBlob)], outName, { type: 'application/pdf' });
      await navigator.share({ files: [file], title: outName });
    } catch {
      // User cancelled or share failed — silently ignore (no error UX needed).
    }
  }

  function onVerifyNow(): void {
    // Stash signed bytes for /verificar to pick up. Use sessionStorage with a marker key.
    try {
      // sessionStorage cannot hold raw bytes — encode as base64.
      const b64 = uint8ToBase64(signedPdfBlob);
      sessionStorage.setItem('firmar.verify_preload.bytes_b64', b64);
      sessionStorage.setItem('firmar.verify_preload.name', outName);
    } catch {
      // Storage may be full; verifier will fallback to drop UI.
    }
    push('/verificar');
  }

  function uint8ToBase64(bytes: Uint8Array): string {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return btoa(bin);
  }

  const sizeKB = $derived(Math.max(1, Math.round(signedPdfBlob.byteLength / 1024)));
  const sizeCountLabel = $derived(
    t('firmar.step7.size_count').replace('{kb}', String(sizeKB)).replace('{n}', String(signatureCount)),
  );

  // F6 §Task 16 / F6.2 — derive the i18n key for a failed-timestamp toast.
  // We only surface the warn toast when the user explicitly enabled TSA but
  // the round-trip failed (network/timeout/rejected/malformed/rate_limited).
  // The "no warning" cases:
  //   - `user_disabled`: silent (user knows they turned TSA off).
  //   - `multifirma_path` / legacy `disabled`: rendered as an informational
  //     pill below, NOT as a warning — re-signing an already-signed PDF is a
  //     valid action and the user deserves an honest explanation.
  const tsaFailureKey = $derived.by((): UIKey | null => {
    if (!timestamp || timestamp.ok) return null;
    const reason = timestamp.reason;
    if (reason === 'user_disabled' || reason === 'multifirma_path' || reason === 'disabled') {
      return null;
    }
    const fallback = reason ?? 'network';
    const map: Record<'timeout' | 'network' | 'rate_limited' | 'rejected' | 'malformed', UIKey> = {
      timeout: 'firmar.tsa.failed.timeout',
      network: 'firmar.tsa.failed.network',
      rate_limited: 'firmar.tsa.failed.rate_limited',
      rejected: 'firmar.tsa.failed.rejected',
      malformed: 'firmar.tsa.failed.malformed',
    };
    return map[fallback as keyof typeof map] ?? null;
  });

  // F6.2 — informational pill: "additional signature on already-signed PDF".
  // Triggers on `multifirma_path` (new) and `disabled` (legacy alias retained
  // for backward compat with older sign-worker bundles still cached in SWs).
  const showMultifirmaPill = $derived.by((): boolean => {
    if (!timestamp || timestamp.ok) return false;
    return timestamp.reason === 'multifirma_path' || timestamp.reason === 'disabled';
  });

  // ── F3.5 outbox CTAs (only when arriving from /inbox) ────────────────
  const inboxCtx = $derived(getInboxContext());
  const isInboxFlow = $derived(!!inboxCtx && inboxCtx.source === 'inbox' && !!inboxCtx.pdfId);

  type OutboxStatus = 'idle' | 'sending_original' | 'phone_form' | 'sending_phone' | 'sent' | 'error';
  let outboxStatus = $state<OutboxStatus>('idle');
  let outboxError = $state<string | null>(null);
  let outboxSuccess = $state<string | null>(null);
  let phoneNumber = $state<string>('+593');
  let phoneError = $state<string | null>(null);

  function mapOutboxError(err: unknown): string {
    if (err instanceof InboxApiError) {
      if (err.status === 429 || err.code === 'rate_limited') {
        return t('inbox.outbox.error_rate_limited');
      }
      if (err.status === 401) return t('inbox.outbox.error_unauthorized');
      if (err.code === 'invalid_phone' || err.status === 422) {
        return t('inbox.outbox.phone_invalid');
      }
    }
    return t('inbox.outbox.error_generic');
  }

  async function onResendOriginal(): Promise<void> {
    if (!inboxCtx || !inboxCtx.pdfId) return;
    outboxStatus = 'sending_original';
    outboxError = null;
    outboxSuccess = null;
    try {
      const signedPdfB64 = bytesToBase64(signedPdfBlob);
      await outboxSend(
        { id: inboxCtx.pdfId, signedPdfB64, target: { kind: 'original' } },
        inboxCtx.jwt,
      );
      outboxStatus = 'sent';
      outboxSuccess = t('inbox.outbox.success');
      touchInbox();
    } catch (err) {
      outboxStatus = 'error';
      outboxError = mapOutboxError(err);
      if (err instanceof InboxApiError && err.status === 401) {
        clearInboxContext();
      }
    }
  }

  function showPhoneForm(): void {
    outboxStatus = 'phone_form';
    outboxError = null;
    phoneError = null;
  }

  function cancelPhoneForm(): void {
    outboxStatus = 'idle';
    phoneError = null;
  }

  async function onResendPhone(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!inboxCtx || !inboxCtx.pdfId) return;
    const trimmed = phoneNumber.trim();
    if (!isValidEcuadorPhone(trimmed)) {
      phoneError = t('inbox.outbox.phone_invalid');
      return;
    }
    phoneError = null;
    outboxStatus = 'sending_phone';
    outboxError = null;
    outboxSuccess = null;
    try {
      const signedPdfB64 = bytesToBase64(signedPdfBlob);
      await outboxSend(
        {
          id: inboxCtx.pdfId,
          signedPdfB64,
          target: { kind: 'phone', phone: trimmed },
        },
        inboxCtx.jwt,
      );
      outboxStatus = 'sent';
      outboxSuccess = t('inbox.outbox.success');
      touchInbox();
    } catch (err) {
      outboxStatus = 'error';
      outboxError = mapOutboxError(err);
      if (err instanceof InboxApiError && err.status === 401) {
        clearInboxContext();
      }
    }
  }
</script>

<section class="container max-w-2xl mx-auto px-4 py-12 md:py-16 text-center">
  <!-- Success icon w/ glow -->
  <div class="flex justify-center mb-6">
    <div class="success-icon" aria-hidden="true">
      <span class="i-lucide-circle-check-big text-5xl text-ok-500"></span>
    </div>
  </div>

  <h1 class="text-2xl md:text-3xl font-display font-bold tracking-tight mb-2">
    {t('firmar.step7.success_title')}
  </h1>
  <p class="text-ink-600 dark:text-ink-300 mb-1">
    {t('firmar.step7.success_subtitle')}
  </p>
  <p class="text-xs text-ink-500 dark:text-ink-500 font-mono mb-4">
    {outName} · {sizeCountLabel}
  </p>

  <!-- F6 §Task 17 — gold success badge when the TSA round-trip succeeded. -->
  {#if timestamp?.ok}
    <div class="mx-auto max-w-md mb-4">
      <TimestampBadge
        badge="gold"
        context="firmar"
        signingTime={timestamp.signingTime}
        tsaIssuer={timestamp.tsaIssuerCN}
      />
    </div>
  {/if}

  <!-- F7 §T30 — LTV badge underneath the TimestampBadge. Renders only for
       B-LT / B-LTA (collapses out of the layout for B-T / B-B). -->
  {#if ltvBadgeData}
    <div class="mx-auto max-w-md mb-4">
      <LtvBadge ltv={ltvBadgeData} />
    </div>
  {/if}

  <!-- F6 §Task 16 — non-blocking warning when TSA was requested but failed. -->
  {#if tsaFailureKey}
    <div
      role="status"
      aria-live="polite"
      class="mx-auto max-w-md mb-4 rounded-2xl border border-warn-500/40 bg-warn-500/10 px-5 py-3 flex items-start gap-2.5 text-left"
    >
      <span class="i-lucide-alert-triangle text-base text-warn-500 shrink-0 mt-0.5" aria-hidden="true"></span>
      <div class="flex-1 min-w-0 text-sm">
        <p class="text-ink-700 dark:text-ink-200">{t('firmar.tsa.fallback_warn')}</p>
        <p class="text-xs text-ink-500 dark:text-ink-400 mt-0.5">{t(tsaFailureKey)}</p>
      </div>
    </div>
  {/if}

  <!--
    F6.2 — informational pill explaining why the gold timestamp badge is absent
    when the user re-signs an already-signed PDF. Rendered as info (not warn)
    because the action is valid and the prior signatures keep their own seals.
  -->
  {#if showMultifirmaPill}
    <div
      role="status"
      aria-live="polite"
      class="mx-auto max-w-md mb-4 rounded-2xl border border-ink-200 dark:border-ink-700 bg-ink-50 dark:bg-ink-900 px-5 py-3 flex items-start gap-2.5 text-left"
      data-testid="multifirma-pill"
    >
      <span class="i-lucide-info text-base text-ink-500 shrink-0 mt-0.5" aria-hidden="true"></span>
      <div class="flex-1 min-w-0 text-sm">
        <p class="text-ink-700 dark:text-ink-200 font-medium">{t('firmar.tsa.multifirma_pill_title')}</p>
        <p class="text-xs text-ink-500 dark:text-ink-400 mt-0.5">{t('firmar.tsa.multifirma_pill_body')}</p>
      </div>
    </div>
  {/if}

  <!-- Primary CTA: Download (re-trigger if needed) -->
  <button
    type="button"
    onclick={triggerDownload}
    disabled={!blobUrl}
    class="
      w-full sm:w-auto inline-flex items-center justify-center gap-2
      h-12 px-7 rounded-md
      bg-brand-500 hover:bg-brand-600 active:scale-[0.98]
      text-white font-medium
      transition-all duration-100
      disabled:opacity-50 disabled:cursor-not-allowed
      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2
    "
    style="box-shadow: var(--shadow-rest);"
  >
    <span class="i-lucide-download text-base" aria-hidden="true"></span>
    {t('firmar.step7.download')}
  </button>

  {#if autoDownloadFired}
    <p class="mt-3 text-xs text-ink-500 dark:text-ink-500">
      {t('firmar.step7.no_download_hint')}
    </p>
  {/if}

  <!-- Secondary actions -->
  <div class="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
    {#if canShare}
      <button
        type="button"
        onclick={onShare}
        class="
          inline-flex items-center justify-center gap-2
          h-11 px-5 rounded-md
          border border-ink-300 dark:border-ink-700
          bg-ink-50 dark:bg-ink-900
          hover:bg-ink-100 dark:hover:bg-ink-800
          text-ink-700 dark:text-ink-100 font-medium
          transition-colors
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2
        "
      >
        <span class="i-lucide-share-2 text-base" aria-hidden="true"></span>
        {t('firmar.step7.share')}
      </button>
    {/if}

    <button
      type="button"
      onclick={onVerifyNow}
      class="
        inline-flex items-center justify-center gap-2
        h-11 px-5 rounded-md
        border border-ink-300 dark:border-ink-700
        bg-ink-50 dark:bg-ink-900
        hover:bg-ink-100 dark:hover:bg-ink-800
        text-ink-700 dark:text-ink-100 font-medium
        transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2
      "
    >
      <span class="i-lucide-shield-check text-base" aria-hidden="true"></span>
      {t('firmar.step7.verify_now')}
    </button>

    <button
      type="button"
      onclick={onsignagain}
      class="
        inline-flex items-center justify-center gap-2
        h-11 px-5 rounded-md
        text-ink-600 dark:text-ink-300 hover:text-ink-900 dark:hover:text-ink-50
        hover:bg-ink-100 dark:hover:bg-ink-800
        font-medium
        transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2
      "
    >
      <span class="i-lucide-rotate-cw text-base" aria-hidden="true"></span>
      {t('firmar.step7.again')}
    </button>
  </div>

  {#if isInboxFlow}
    <section
      class="mt-8 rounded-2xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 p-5 md:p-6 text-left"
      aria-labelledby="outbox-heading"
    >
      <h2 id="outbox-heading" class="font-display font-semibold text-base mb-4 flex items-center gap-2">
        <span class="i-lucide-send text-base text-brand-500" aria-hidden="true"></span>
        {t('inbox.outbox.heading')}
      </h2>

      {#if outboxStatus === 'sent' && outboxSuccess}
        <div role="status" aria-live="polite" class="rounded-md border border-ok-500/40 bg-ok-500/10 px-4 py-3 text-sm text-ok-500 mb-3">
          <span class="i-lucide-check-circle text-base align-middle mr-1.5" aria-hidden="true"></span>
          {outboxSuccess}
        </div>
      {/if}
      {#if outboxError}
        <div role="alert" class="rounded-md border border-err-500/40 bg-err-500/10 px-4 py-3 text-sm text-err-500 mb-3">
          {outboxError}
        </div>
      {/if}

      {#if outboxStatus !== 'phone_form' && outboxStatus !== 'sending_phone'}
        <div class="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <Button
            variant="primary"
            size="sm"
            disabled={outboxStatus === 'sending_original' || outboxStatus === 'sent'}
            onclick={onResendOriginal}
          >
            {#if outboxStatus === 'sending_original'}
              <span class="i-lucide-loader-2 animate-spin text-base" aria-hidden="true"></span>
              {t('inbox.outbox.sending')}
            {:else}
              <span class="i-lucide-corner-up-left text-base" aria-hidden="true"></span>
              {t('inbox.outbox.resend_original')}
            {/if}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={outboxStatus === 'sending_original' || outboxStatus === 'sent'}
            onclick={showPhoneForm}
          >
            <span class="i-lucide-phone text-base" aria-hidden="true"></span>
            {t('inbox.outbox.resend_phone')}
          </Button>
        </div>
      {:else}
        <form class="flex flex-col gap-3" onsubmit={onResendPhone} novalidate>
          <label for="outbox-phone" class="text-sm font-medium text-ink-700 dark:text-ink-200">
            {t('inbox.outbox.phone_label')}
          </label>
          <input
            id="outbox-phone"
            type="tel"
            inputmode="tel"
            autocomplete="tel"
            bind:value={phoneNumber}
            placeholder={t('inbox.outbox.phone_placeholder')}
            disabled={outboxStatus === 'sending_phone'}
            aria-describedby="outbox-phone-hint outbox-phone-error"
            aria-invalid={phoneError ? 'true' : undefined}
            class="h-11 px-4 rounded-md border border-ink-300 dark:border-ink-700 bg-white dark:bg-ink-950 text-ink-900 dark:text-ink-50 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950 disabled:opacity-60"
          />
          <p id="outbox-phone-hint" class="text-xs text-ink-500">
            {t('inbox.outbox.phone_hint')}
          </p>
          <div id="outbox-phone-error" aria-live="polite" class="min-h-[1.25rem]">
            {#if phoneError}
              <p class="text-sm text-err-500">{phoneError}</p>
            {/if}
          </div>
          <div class="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <Button type="submit" variant="primary" size="sm" disabled={outboxStatus === 'sending_phone'}>
              {#if outboxStatus === 'sending_phone'}
                <span class="i-lucide-loader-2 animate-spin text-base" aria-hidden="true"></span>
                {t('inbox.outbox.sending')}
              {:else}
                <span class="i-lucide-send text-base" aria-hidden="true"></span>
                {t('inbox.outbox.send')}
              {/if}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={outboxStatus === 'sending_phone'}
              onclick={cancelPhoneForm}
            >
              {t('inbox.outbox.cancel')}
            </Button>
          </div>
        </form>
      {/if}
    </section>
  {/if}

  <p class="mt-10 text-xs text-ink-500 dark:text-ink-500">
    <span class="i-lucide-shield text-ok-500 align-middle inline-block mr-1" aria-hidden="true"></span>
    {t('firmar.step7.privacy_done')}
  </p>

  <!-- Lang awareness reactive marker (avoids unused warning when reactive labels live in template). -->
  {#if false}{lang}{/if}
</section>

<style>
  .success-icon {
    width: 88px;
    height: 88px;
    border-radius: var(--r-full);
    background: oklch(64% 0.16 145 / 0.10);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-success);
    animation: emerge var(--motion-emerge) var(--motion-curve);
  }
  @keyframes emerge {
    0% {
      opacity: 0;
      transform: scale(0);
    }
    60% {
      opacity: 1;
      transform: scale(1.05);
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .success-icon { animation: none; }
  }
</style>
