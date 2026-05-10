<script lang="ts">
  /**
   * Inbox.svelte — F3.5 WhatsApp inbox entry point.
   *
   * Flow:
   *   1. ?t=<OTP> in URL → auto-verify; otherwise show 6-digit form.
   *   2. POST /api/inbox/verify → JWT (memory-only) + items list.
   *   3. List cards. Per-card actions: Firmar, Verificar, Descargar.
   *   4. Action click → fetch /blob (ciphertext + IV header) + /meta (salt) →
   *      decryptFromR2(otp, salt, iv, ciphertext) → plaintext PDF Uint8Array.
   *   5. For Firmar/Verificar: stash bytes via sharedFile.stash() and
   *      push() to /firmar or /verificar (those routes consume on mount).
   *   6. For Descargar: blob URL + <a download> click.
   *   7. Idle re-prompt: if last interaction >10min ago on visit, force OTP.
   *
   * The `@firma-ec/inbox-crypto` package is dynamic-imported so it lands in
   * the lazy /inbox chunk, not the base entry bundle (T23 budget).
   */
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { t, tp } from '../lib/i18n.svelte.ts';
  import {
    verifyOtp,
    fetchMeta,
    fetchBlob,
    formatSize,
    relativeTime,
    InboxApiError,
    type InboxItemRaw,
  } from '../lib/inboxApi.ts';
  import {
    setContext,
    clear as clearInbox,
    isIdleExpired,
    clearIdleStamp,
    touch,
  } from '../lib/inboxStore.ts';
  import { stash as stashSharedPdf } from '../lib/sharedFile.ts';
  import Button from '../ui/Button.svelte';

  type Phase = 'otp_entry' | 'verifying' | 'list' | 'opening';

  interface ItemCard extends InboxItemRaw {
    busy: boolean;
  }

  let phase = $state<Phase>('otp_entry');
  let otp = $state<string>('');
  let otpError = $state<string | null>(null);
  let listError = $state<string | null>(null);
  let idleNotice = $state<boolean>(false);
  // Memory-only — never persisted.
  let jwt = $state<string | null>(null);
  let items = $state<ItemCard[]>([]);

  // Capture the OTP separately so we can use it as the KDF input later. We
  // intentionally keep it in module memory only; cleared on unmount + idle.
  let activeOtp = $state<string>('');

  /**
   * Read ?t=<OTP> from the hash router URL. svelte-spa-router v5 doesn't
   * expose `location`/`querystring` as importable stores anymore; we just
   * parse window.location.hash directly which is what the router does too.
   */
  function readOtpFromUrl(): string | null {
    if (typeof window === 'undefined') return null;
    const hash = window.location.hash || '';
    // hash typically: '#/inbox?t=123456' or '#/inbox'
    const qIdx = hash.indexOf('?');
    if (qIdx < 0) return null;
    const qs = hash.substring(qIdx + 1);
    const sp = new URLSearchParams(qs);
    return sp.get('t');
  }

  async function doVerify(candidate: string): Promise<void> {
    otpError = null;
    listError = null;
    if (!/^\d{6}$/.test(candidate)) {
      otpError = t('inbox.otp.error_invalid');
      return;
    }
    phase = 'verifying';
    try {
      const res = await verifyOtp(candidate);
      jwt = res.jwt;
      activeOtp = candidate;
      items = res.items.map((it) => ({ ...it, busy: false }));
      setContext({ pdfId: '', jwt: res.jwt, otp: candidate, source: 'inbox' });
      phase = 'list';
      touch();
    } catch (err) {
      jwt = null;
      activeOtp = '';
      if (err instanceof InboxApiError) {
        if (err.status === 429 || err.code === 'rate_limited') {
          otpError = t('inbox.otp.error_rate_limited');
        } else if (err.status === 401 || err.code === 'bad_otp') {
          otpError = t('inbox.otp.error_invalid');
        } else {
          otpError = t('inbox.otp.error_generic');
        }
      } else {
        otpError = t('inbox.otp.error_generic');
      }
      phase = 'otp_entry';
    }
  }

  function onOtpSubmit(e: SubmitEvent): void {
    e.preventDefault();
    void doVerify(otp);
  }

  /**
   * Load + decrypt one item. Centralizes the fetch/meta/blob/decrypt
   * pipeline shared by Firmar, Verificar and Descargar actions.
   */
  async function loadAndDecrypt(item: ItemCard): Promise<Uint8Array | null> {
    if (!jwt || !activeOtp) {
      idleNotice = true;
      forceReprompt();
      return null;
    }
    try {
      const [meta, blob] = await Promise.all([
        fetchMeta(item.id, jwt),
        fetchBlob(item.id, jwt),
      ]);
      const saltBytes = base64ToBytes(meta.saltB64);
      // Lazy: keep crypto out of the base entry chunk.
      const { decryptFromR2 } = await import('@firma-ec/inbox-crypto');
      const pdf = await decryptFromR2(activeOtp, saltBytes, blob.iv, blob.ciphertext);
      return pdf;
    } catch (err) {
      if (err instanceof InboxApiError && err.status === 401) {
        idleNotice = true;
        forceReprompt();
        return null;
      }
      listError =
        err instanceof InboxApiError && err.code === 'decrypt_failed'
          ? t('inbox.error.decrypt_failed')
          : t('inbox.error.fetch_failed');
      return null;
    }
  }

  function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function onSign(item: ItemCard): Promise<void> {
    if (item.busy || phase === 'opening') return;
    item.busy = true;
    phase = 'opening';
    try {
      const pdf = await loadAndDecrypt(item);
      if (!pdf || !jwt) return;
      // Hand off to /firmar via sharedFile sessionStorage (existing pattern).
      stashSharedPdf(pdf, t('inbox.list.filename_unknown') + '.pdf');
      // Update inbox context with the active pdfId so DownloadResult sees it.
      setContext({ pdfId: item.id, jwt, otp: activeOtp, source: 'inbox' });
      touch();
      push('/firmar');
    } finally {
      item.busy = false;
      if (phase === 'opening') phase = 'list';
    }
  }

  async function onVerify(item: ItemCard): Promise<void> {
    if (item.busy || phase === 'opening') return;
    item.busy = true;
    phase = 'opening';
    try {
      const pdf = await loadAndDecrypt(item);
      if (!pdf || !jwt) return;
      // /verificar consumes via its own sessionStorage key (firmar.verify_preload.bytes_b64).
      try {
        const b64 = bytesToBase64(pdf);
        sessionStorage.setItem('firmar.verify_preload.bytes_b64', b64);
        sessionStorage.setItem(
          'firmar.verify_preload.name',
          t('inbox.list.filename_unknown') + '.pdf',
        );
      } catch (_) {
        /* fall through — verifier will show drop UI */
      }
      setContext({ pdfId: item.id, jwt, otp: activeOtp, source: 'inbox' });
      touch();
      push('/verificar');
    } finally {
      item.busy = false;
      if (phase === 'opening') phase = 'list';
    }
  }

  async function onDownload(item: ItemCard): Promise<void> {
    if (item.busy || phase === 'opening') return;
    item.busy = true;
    phase = 'opening';
    try {
      const pdf = await loadAndDecrypt(item);
      if (!pdf) return;
      const blob = new Blob([toArrayBuffer(pdf)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = t('inbox.list.filename_unknown') + '.pdf';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after the click hand-off completes.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      touch();
    } finally {
      item.busy = false;
      if (phase === 'opening') phase = 'list';
    }
  }

  function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
    const out = new ArrayBuffer(u8.byteLength);
    new Uint8Array(out).set(u8);
    return out;
  }

  function bytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return btoa(bin);
  }

  function forceReprompt(): void {
    jwt = null;
    activeOtp = '';
    items = [];
    otp = '';
    clearInbox();
    clearIdleStamp();
    phase = 'otp_entry';
  }

  function sizeLabel(bytes: number): string {
    const { value, unit } = formatSize(bytes);
    return tp(unit === 'MB' ? 'inbox.list.size_mb' : 'inbox.list.size_kb', { value });
  }

  function relTimeLabel(iso: string): string {
    const r = relativeTime(iso);
    if (r.bucket === 'just_now') return t('inbox.list.created_at_just_now');
    if (r.bucket === 'minutes_ago') {
      return tp('inbox.list.created_at_minutes_ago', { n: r.value });
    }
    return tp('inbox.list.created_at_hours_ago', { n: r.value });
  }

  // Mount: idle check + auto-verify if ?t=<OTP>.
  onMount(() => {
    if (isIdleExpired()) {
      idleNotice = true;
      forceReprompt();
    }
    const auto = readOtpFromUrl();
    if (auto) {
      otp = auto;
      void doVerify(auto);
    }
  });

  // Reactive: hide idle notice once user starts typing again.
  $effect(() => {
    if (otp.length > 0) idleNotice = false;
  });
</script>

<section class="container max-w-2xl mx-auto px-4 py-12 md:py-16">
  <header class="mb-8">
    <h1 class="text-3xl md:text-4xl font-display font-bold tracking-tight mb-2">
      {t('inbox.title')}
    </h1>
    <p class="text-ink-500 text-base md:text-lg">{t('inbox.subtitle')}</p>
  </header>

  {#if idleNotice}
    <aside
      role="status"
      aria-live="polite"
      class="mb-6 rounded-2xl border border-warn-500/40 bg-warn-500/10 px-5 py-4"
    >
      <p class="text-sm text-ink-700 dark:text-ink-200">
        <span class="i-lucide-clock text-base text-warn-500 mr-1.5 align-middle" aria-hidden="true"></span>
        {t('inbox.idle.reentry_required')}
      </p>
    </aside>
  {/if}

  {#if phase === 'otp_entry' || phase === 'verifying'}
    <form
      class="rounded-2xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 p-6 md:p-8"
      onsubmit={onOtpSubmit}
      novalidate
    >
      <label for="inbox-otp" class="block text-sm font-medium text-ink-700 dark:text-ink-200 mb-2">
        {t('inbox.otp.label')}
      </label>
      <input
        id="inbox-otp"
        type="text"
        inputmode="numeric"
        pattern="[0-9]{'{'}6{'}'}"
        maxlength="6"
        autocomplete="one-time-code"
        autofocus
        bind:value={otp}
        disabled={phase === 'verifying'}
        placeholder={t('inbox.otp.placeholder')}
        aria-describedby="inbox-otp-hint inbox-otp-error"
        aria-invalid={otpError ? 'true' : undefined}
        class="w-full h-14 px-4 rounded-md border border-ink-300 dark:border-ink-700 bg-white dark:bg-ink-950 text-2xl font-mono tracking-[0.3em] text-center text-ink-900 dark:text-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950 disabled:opacity-60"
      />
      <p id="inbox-otp-hint" class="mt-2 text-xs text-ink-500">
        {t('inbox.otp.hint')}
      </p>
      <div id="inbox-otp-error" aria-live="polite" class="min-h-[1.25rem]">
        {#if otpError}
          <p class="mt-2 text-sm text-err-500">{otpError}</p>
        {/if}
      </div>
      <div class="mt-5 flex justify-end">
        <Button type="submit" variant="primary" size="md" disabled={phase === 'verifying' || otp.length !== 6}>
          {#if phase === 'verifying'}
            <span class="i-lucide-loader-2 animate-spin text-base" aria-hidden="true"></span>
            {t('inbox.otp.verifying')}
          {:else}
            <span class="i-lucide-mail-open text-base" aria-hidden="true"></span>
            {t('inbox.otp.submit')}
          {/if}
        </Button>
      </div>
    </form>
  {:else if phase === 'list' || phase === 'opening'}
    <div class="flex flex-col gap-4">
      <h2 class="font-display font-semibold text-lg">{t('inbox.list.title')}</h2>
      {#if listError}
        <div role="alert" class="rounded-md border border-err-500/40 bg-err-500/10 px-4 py-3 text-sm text-err-500">
          {listError}
        </div>
      {/if}
      {#if items.length === 0}
        <div class="rounded-2xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 p-6 text-center">
          <p class="text-sm text-ink-600 dark:text-ink-300">{t('inbox.list.empty')}</p>
        </div>
      {:else}
        {#each items as item (item.id)}
          <article
            class="rounded-2xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 p-5 md:p-6 transition-shadow duration-200"
            style="transition-timing-function: cubic-bezier(0.32, 0.72, 0, 1);"
          >
            <header class="flex items-start gap-3 mb-4">
              <span class="i-lucide-file-text text-2xl text-brand-500 shrink-0 mt-0.5" aria-hidden="true"></span>
              <div class="flex-1 min-w-0">
                <p class="font-medium text-ink-900 dark:text-ink-50">
                  {t('inbox.list.filename_unknown')}
                </p>
                <p class="text-xs text-ink-500 mt-0.5">{t('inbox.list.filename_caption')}</p>
                <p class="text-xs text-ink-500 mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  <span>{sizeLabel(item.sizeBytes)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{relTimeLabel(item.createdAt)}</span>
                  {#if item.senderPhoneMasked}
                    <span aria-hidden="true">·</span>
                    <span>{tp('inbox.list.from_masked', { phone: item.senderPhoneMasked })}</span>
                  {/if}
                </p>
              </div>
            </header>
            <div class="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <Button
                variant="primary"
                size="sm"
                disabled={item.busy}
                onclick={() => onSign(item)}
              >
                <span class="i-lucide-pen-tool text-base" aria-hidden="true"></span>
                {item.busy ? t('inbox.actions.opening') : t('inbox.actions.sign')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={item.busy}
                onclick={() => onVerify(item)}
              >
                <span class="i-lucide-shield-check text-base" aria-hidden="true"></span>
                {t('inbox.actions.verify')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={item.busy}
                onclick={() => onDownload(item)}
              >
                <span class="i-lucide-download text-base" aria-hidden="true"></span>
                {t('inbox.actions.download')}
              </Button>
            </div>
          </article>
        {/each}
      {/if}
    </div>
  {/if}
</section>
