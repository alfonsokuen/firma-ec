<script lang="ts">
  /**
   * SharedFileHandler.svelte — landing route for OS-delivered PDFs.
   *
   * Reached two ways in v0.4.0:
   *   1. file_handlers (Chromium "Open with" menu) → window.launchQueue fires.
   *   2. share_target GET fallback (text/url) — file delivery via POST is
   *      deferred to v0.4.1 (requires a custom SW; see vite.config.ts comment).
   *
   * Pipeline: receive bytes → detectSignatures → stash() → redirect:
   *   - signatures > 0 → /verificar (verification flow).
   *   - signatures = 0 → /firmar    (signing wizard).
   *
   * Privacy: bytes live in sessionStorage only for the duration of the redirect.
   * Both Verificar and Firmar consume() it on mount, which clears the entry.
   */
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { detectSignatures } from '@firma-ec/signer';
  import { t } from '../lib/i18n.svelte.ts';
  import { stash } from '../lib/sharedFile.ts';

  type Phase = 'waiting' | 'processing' | 'error';

  let phase = $state<Phase>('waiting');
  let errorKey = $state<'share.error.not_pdf' | 'share.error.too_big' | 'share.error.read'>('share.error.read');

  const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — same cap as Verificar/Firmar

  async function process(bytes: Uint8Array, name: string): Promise<void> {
    phase = 'processing';
    if (bytes.byteLength > MAX_BYTES) {
      errorKey = 'share.error.too_big';
      phase = 'error';
      return;
    }
    // Sniff first 5 bytes for "%PDF-" — file_handlers should already enforce
    // application/pdf, but share_target POST may deliver something else once
    // v0.4.1 lands, and a defensive check costs nothing.
    if (bytes.byteLength < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
      errorKey = 'share.error.not_pdf';
      phase = 'error';
      return;
    }
    let detected: Awaited<ReturnType<typeof detectSignatures>> = [];
    try {
      detected = await detectSignatures(bytes);
    } catch (_) {
      detected = [];
    }
    stash(bytes, name);
    // svelte-spa-router uses hash routing, so `push` goes to the in-app route.
    if (detected.length > 0) {
      push('/verificar?from=share');
    } else {
      push('/firmar?from=share');
    }
  }

  onMount(() => {
    // 1) Chromium file_handlers — window.launchQueue.
    const w = window as unknown as {
      launchQueue?: { setConsumer: (cb: (params: { files: FileSystemFileHandle[] }) => void) => void };
    };
    if (w.launchQueue && typeof w.launchQueue.setConsumer === 'function') {
      w.launchQueue.setConsumer(async ({ files }) => {
        if (!files || files.length === 0) return;
        const fh = files[0];
        if (!fh) return;
        try {
          const file = await fh.getFile();
          const buf = await file.arrayBuffer();
          await process(new Uint8Array(buf), file.name);
        } catch (_) {
          errorKey = 'share.error.read';
          phase = 'error';
        }
      });
    }

    // 2) v0.4.1 SW handoff (placeholder): when the custom SW lands, it will
    //    cache the POST body under a known key and ping us via postMessage or
    //    set a sessionStorage flag. Until then, hitting /share with no payload
    //    just shows the "waiting" UI and the user can click the home link.
    //    Detect a SW-set flag anyway so v0.4.1 can light up without a redeploy
    //    of the SPA bundle.
    try {
      const flag = sessionStorage.getItem('__shareFromSW');
      if (flag === '1') {
        // SW is expected to also stash bytes under __incomingPdf via Cache API
        // round-trip; nothing to do here in v0.4.0.
        sessionStorage.removeItem('__shareFromSW');
      }
    } catch (_) {
      /* noop */
    }
  });

  function backHome(): void {
    push('/');
  }
</script>

<section class="container max-w-xl mx-auto px-4 py-12 text-center">
  {#if phase === 'waiting'}
    <div class="flex flex-col items-center gap-4" aria-live="polite">
      <span class="i-lucide-loader-2 text-4xl text-brand-500 animate-spin" aria-hidden="true"></span>
      <h1 class="text-2xl font-display font-semibold">{t('share.processing')}</h1>
      <p class="text-sm text-ink-500">{t('share.waiting_hint')}</p>
    </div>
  {:else if phase === 'processing'}
    <div class="flex flex-col items-center gap-4" aria-live="polite">
      <span class="i-lucide-file-search text-4xl text-brand-500" aria-hidden="true"></span>
      <h1 class="text-2xl font-display font-semibold">{t('share.processing')}</h1>
    </div>
  {:else}
    <div class="flex flex-col items-center gap-4" role="alert">
      <span class="i-lucide-alert-triangle text-4xl text-warn-500" aria-hidden="true"></span>
      <h1 class="text-2xl font-display font-semibold">{t(errorKey)}</h1>
      <button
        type="button"
        class="mt-4 px-5 py-2 rounded-lg bg-brand-500 text-white font-medium hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        onclick={backHome}
      >
        {t('share.back_home')}
      </button>
    </div>
  {/if}
</section>
