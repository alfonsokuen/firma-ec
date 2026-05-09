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
  import { t, getLang } from '../../lib/i18n.svelte.ts';
  import { onMount, onDestroy } from 'svelte';
  import { push } from 'svelte-spa-router';

  interface Props {
    /** Bytes del PDF firmado. */
    signedPdfBlob: Uint8Array;
    /** Filename original (incluye .pdf). */
    originalName: string;
    /** Cantidad de firmas en el PDF firmado (para size_count). */
    signatureCount?: number;
    /** Reset wizard al paso 1. */
    onsignagain: () => void;
  }

  const {
    signedPdfBlob,
    originalName,
    signatureCount = 1,
    onsignagain,
  }: Props = $props();

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
  <p class="text-xs text-ink-500 dark:text-ink-500 font-mono mb-8">
    {outName} · {sizeCountLabel}
  </p>

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
