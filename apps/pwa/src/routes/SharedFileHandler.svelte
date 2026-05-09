<script lang="ts">
  /**
   * SharedFileHandler.svelte — landing route for OS-delivered PDFs.
   *
   * Reached three ways:
   *   1. file_handlers (Chromium "Open with" menu) → window.launchQueue fires.
   *   2. share_target POST (v0.4.1) → custom SW intercepts, stashes the PDF
   *      in Cache Storage under `/__shared-pdf__/<uuid>` and 303-redirects to
   *      `/#/share?pdfId=<uuid>`. We fetch the cache entry here.
   *   3. share_target GET fallback (text/url) — no payload; "waiting" UI.
   *
   * Pipeline: receive bytes → detectSignatures → stash() → redirect:
   *   - signatures > 0 → /verificar (verification flow).
   *   - signatures = 0 → /firmar    (signing wizard).
   *
   * Privacy: bytes live in Cache Storage briefly (TTL 10min, SW cleans up) and
   * then in sessionStorage during the redirect. Both Verificar and Firmar
   * consume() it on mount, which clears the entry. We also delete the cache
   * entry as soon as we read it.
   */
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { detectSignatures } from '@firma-ec/signer';
  import { t } from '../lib/i18n.svelte.ts';
  import { stash } from '../lib/sharedFile.ts';

  type Phase = 'waiting' | 'processing' | 'error';
  type ErrorKey =
    | 'share.error.not_pdf'
    | 'share.error.too_big'
    | 'share.error.read'
    | 'share.error.invalid_pdf'
    | 'share.error.no_file'
    | 'share.error.internal';

  let phase = $state<Phase>('waiting');
  let errorKey = $state<ErrorKey>('share.error.read');

  const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — same cap as Verificar/Firmar

  function readHashParams(): URLSearchParams {
    try {
      const hash = window.location.hash || '';
      const qIdx = hash.indexOf('?');
      if (qIdx === -1) return new URLSearchParams();
      return new URLSearchParams(hash.slice(qIdx + 1));
    } catch (_) {
      return new URLSearchParams();
    }
  }

  function mapShareError(code: string): ErrorKey {
    switch (code) {
      case 'no_file':
        return 'share.error.no_file';
      case 'not_pdf':
        return 'share.error.not_pdf';
      case 'too_big':
        return 'share.error.too_big';
      case 'invalid_pdf':
        return 'share.error.invalid_pdf';
      case 'internal':
        return 'share.error.internal';
      default:
        return 'share.error.read';
    }
  }

  async function fetchFromCache(pdfId: string): Promise<{ bytes: Uint8Array; name: string } | null> {
    if (!('caches' in window)) return null;
    try {
      const cache = await caches.open('shared-pdf-v1');
      const req = new Request(`/__shared-pdf__/${pdfId}`);
      const resp = await cache.match(req);
      if (!resp) return null;
      const buf = await resp.arrayBuffer();
      const rawName = resp.headers.get('X-Filename') || 'shared.pdf';
      let name = 'shared.pdf';
      try {
        name = decodeURIComponent(rawName);
      } catch (_) {
        name = rawName;
      }
      // Privacy: delete immediately on consume.
      await cache.delete(req);
      return { bytes: new Uint8Array(buf), name };
    } catch (_) {
      return null;
    }
  }

  async function process(bytes: Uint8Array, name: string): Promise<void> {
    phase = 'processing';
    if (bytes.byteLength > MAX_BYTES) {
      errorKey = 'share.error.too_big';
      phase = 'error';
      return;
    }
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
    if (detected.length > 0) {
      push('/verificar?from=share');
    } else {
      push('/firmar?from=share');
    }
  }

  onMount(() => {
    const params = readHashParams();

    // 0) Error redirect from SW (?shareError=... forwarded by App.svelte).
    const errCode = params.get('shareError');
    if (errCode) {
      errorKey = mapShareError(errCode);
      phase = 'error';
      return;
    }

    // 1) v0.4.1 SW handoff via Cache Storage — pdfId in the hash query string.
    const pdfId = params.get('pdfId');
    if (pdfId) {
      (async () => {
        const found = await fetchFromCache(pdfId);
        if (!found) {
          errorKey = 'share.error.read';
          phase = 'error';
          return;
        }
        await process(found.bytes, found.name);
      })().catch(() => {
        errorKey = 'share.error.internal';
        phase = 'error';
      });
      return;
    }

    // 2) Chromium file_handlers — window.launchQueue.
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
