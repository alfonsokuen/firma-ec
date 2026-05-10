<script lang="ts">
  /**
   * Configuracion.svelte — F6 §Task 15.
   *
   * User-facing settings for the F6 RFC 3161 timestamp pipeline:
   *  - tsaEnabled — toggle B-T (default-on) ↔ B-B fallback
   *  - tsaUrl — override TSA endpoint (must be https://)
   *  - tsaTimeoutMs — fetch timeout
   *  - "Probar TSA" — round-trip a hash to the configured TSA and surface OK/error
   *
   * All writes are synchronous to localStorage via the store.
   *
   * SECURITY: this view never holds secrets. It renders user preferences only.
   * The CSP allows freetsa.org by default; custom URLs require infra edits.
   */
  import { t } from '../lib/i18n.svelte.ts';
  import {
    DEFAULT_SETTINGS,
    getSettings,
    resetSettings,
    updateSettings,
    validateTsaUrl,
    validateOcspUrl,
    type Settings,
  } from '../lib/settings.svelte.ts';
  import { requestTimestamp } from '@firma-ec/tsa-client';
  import Button from '../ui/Button.svelte';

  const settings = $derived(getSettings() as Settings);

  // Local-edit state for inputs (so we can validate before persisting).
  // Initialized from the persisted store; subsequent reads stay reactive via `settings`.
  let urlDraft = $state<string>(getSettings().tsaUrl);
  let timeoutDraft = $state<number>(getSettings().tsaTimeoutMs);
  let urlError = $state<string | null>(null);
  let saved = $state<boolean>(false);

  // Probe state
  type ProbeState =
    | { status: 'idle' }
    | { status: 'running' }
    | { status: 'ok'; tsaIssuerCN: string; signingTime: Date }
    | { status: 'error'; reason: string; detail?: string };
  let probe = $state<ProbeState>({ status: 'idle' });

  // ---- F7 LTV state ----
  let ocspUrlDraft = $state<string>(getSettings().ocspUrl);
  let ltvTimeoutDraft = $state<number>(getSettings().ltvTimeoutMs);
  let ocspUrlError = $state<string | null>(null);

  type LtvProbeState =
    | { status: 'idle' }
    | { status: 'running' }
    | { status: 'ok'; detail: string }
    | { status: 'error'; reason: string };
  let ltvProbe = $state<LtvProbeState>({ status: 'idle' });

  function onToggle(): void {
    updateSettings({ tsaEnabled: !settings.tsaEnabled });
    saved = true;
    setTimeout(() => (saved = false), 1200);
  }

  function onUrlBlur(): void {
    const trimmed = urlDraft.trim();
    const errorKey = validateTsaUrl(trimmed);
    if (errorKey) {
      urlError = t(errorKey);
      return;
    }
    urlError = null;
    if (trimmed !== settings.tsaUrl) {
      updateSettings({ tsaUrl: trimmed });
      saved = true;
      setTimeout(() => (saved = false), 1200);
    }
  }

  function onTimeoutBlur(): void {
    const v = Number(timeoutDraft);
    if (!Number.isFinite(v) || v < 1000 || v > 60_000) {
      timeoutDraft = settings.tsaTimeoutMs; // revert
      return;
    }
    if (v !== settings.tsaTimeoutMs) {
      updateSettings({ tsaTimeoutMs: v });
      saved = true;
      setTimeout(() => (saved = false), 1200);
    }
  }

  function onReset(): void {
    resetSettings();
    urlDraft = DEFAULT_SETTINGS.tsaUrl;
    timeoutDraft = DEFAULT_SETTINGS.tsaTimeoutMs;
    ocspUrlDraft = DEFAULT_SETTINGS.ocspUrl;
    ltvTimeoutDraft = DEFAULT_SETTINGS.ltvTimeoutMs;
    urlError = null;
    ocspUrlError = null;
    probe = { status: 'idle' };
    ltvProbe = { status: 'idle' };
    saved = true;
    setTimeout(() => (saved = false), 1200);
  }

  async function onProbe(): Promise<void> {
    if (probe.status === 'running') return;
    const errorKey = validateTsaUrl(urlDraft.trim());
    if (errorKey) {
      urlError = t(errorKey);
      return;
    }
    probe = { status: 'running' };
    try {
      // Hash a fixed test vector — the TSA never sees user data.
      const enc = new TextEncoder();
      const imprintBuf = await crypto.subtle.digest(
        'SHA-256',
        enc.encode('firma-ec-configuracion-probe').buffer as ArrayBuffer,
      );
      const imprint = new Uint8Array(imprintBuf);
      const r = await requestTimestamp(imprint, {
        url: urlDraft.trim(),
        timeoutMs: timeoutDraft,
        hashAlgo: 'SHA-256',
      });
      if ('token' in r) {
        probe = {
          status: 'ok',
          tsaIssuerCN: r.tsaCert.subjectCN ?? '—',
          signingTime: r.signingTime,
        };
      } else {
        probe = {
          status: 'error',
          reason: r.error,
          ...(r.detail ? { detail: r.detail } : {}),
        };
      }
    } catch (e) {
      probe = {
        status: 'error',
        reason: 'network',
        detail: (e as Error)?.message ?? String(e),
      };
    }
  }

  // ---- F7 LTV handlers ----
  function onLtvToggle(): void {
    const next = !settings.ltvEnabled;
    updateSettings({ ltvEnabled: next });
    saved = true;
    setTimeout(() => (saved = false), 1200);
  }
  function onLtaToggle(): void {
    if (!settings.ltvEnabled) return;
    updateSettings({ ltvArchiveEnabled: !settings.ltvArchiveEnabled });
    saved = true;
    setTimeout(() => (saved = false), 1200);
  }
  function onOcspUrlBlur(): void {
    const trimmed = ocspUrlDraft.trim();
    const errorKey = validateOcspUrl(trimmed);
    if (errorKey) {
      ocspUrlError = t(errorKey);
      return;
    }
    ocspUrlError = null;
    if (trimmed !== settings.ocspUrl) {
      updateSettings({ ocspUrl: trimmed });
      saved = true;
      setTimeout(() => (saved = false), 1200);
    }
  }
  function onLtvTimeoutBlur(): void {
    const v = Number(ltvTimeoutDraft);
    if (!Number.isFinite(v) || v < 1000 || v > 60_000) {
      ltvTimeoutDraft = settings.ltvTimeoutMs;
      return;
    }
    if (v !== settings.ltvTimeoutMs) {
      updateSettings({ ltvTimeoutMs: v });
      saved = true;
      setTimeout(() => (saved = false), 1200);
    }
  }
  async function onLtvProbe(): Promise<void> {
    if (ltvProbe.status === 'running') return;
    const trimmed = ocspUrlDraft.trim();
    if (!trimmed) {
      ltvProbe = { status: 'error', reason: t('configuracion.ltv.probe_no_url') };
      return;
    }
    const errorKey = validateOcspUrl(trimmed);
    if (errorKey) {
      ocspUrlError = t(errorKey);
      return;
    }
    ltvProbe = { status: 'running' };
    try {
      // Lightweight connectivity probe: HEAD on the OCSP URL (responders accept
      // GET/POST; HEAD typically returns 405 but proves DNS+TLS+routing). We
      // accept any non-network exception as "reachable".
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ltvTimeoutDraft);
      try {
        const r = await fetch(trimmed, { method: 'HEAD', signal: ctrl.signal });
        ltvProbe = { status: 'ok', detail: `HTTP ${r.status}` };
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      ltvProbe = { status: 'error', reason: (e as Error)?.message ?? String(e) };
    }
  }

  function fmtDate(d: Date): string {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  }
</script>

<section class="container max-w-3xl mx-auto px-4 py-12 md:py-16">
  <header class="mb-8">
    <h1 class="text-3xl md:text-4xl font-display font-bold tracking-tight mb-2">
      {t('configuracion.title')}
    </h1>
    <p class="text-ink-500 text-base md:text-lg">
      {t('configuracion.subtitle')}
    </p>
  </header>

  <article
    class="rounded-2xl border border-ink-200 dark:border-ink-800 bg-ink-50/50 dark:bg-ink-900/30 px-6 py-6 md:px-8 md:py-7"
  >
    <header class="flex items-start gap-3 mb-5">
      <span
        class="i-lucide-stamp text-2xl text-brand-500 shrink-0 mt-0.5"
        aria-hidden="true"
      ></span>
      <div class="flex-1 min-w-0">
        <h2 class="font-display font-semibold text-lg">{t('configuracion.tsa.section_title')}</h2>
        <p class="text-sm text-ink-600 dark:text-ink-300 mt-0.5">
          {t('configuracion.tsa.section_lead')}
        </p>
      </div>
    </header>

    <!-- Toggle -->
    <div
      class="flex items-center justify-between gap-4 py-3 border-t border-ink-200 dark:border-ink-800"
    >
      <div class="flex-1 min-w-0">
        <label for="tsa-enabled" class="font-medium block">{t('configuracion.tsa.toggle_label')}</label>
        <p class="text-xs text-ink-500 dark:text-ink-400 mt-0.5">
          {t('configuracion.tsa.toggle_hint')}
        </p>
      </div>
      <button
        id="tsa-enabled"
        type="button"
        role="switch"
        aria-checked={settings.tsaEnabled}
        aria-label={t('configuracion.tsa.toggle_label')}
        onclick={onToggle}
        class="relative inline-flex h-11 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
        class:bg-brand-500={settings.tsaEnabled}
        class:bg-ink-300={!settings.tsaEnabled}
        class:dark:bg-ink-700={!settings.tsaEnabled}
      >
        <span
          class="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
          class:translate-x-6={settings.tsaEnabled}
          class:translate-x-1={!settings.tsaEnabled}
          style="transition-timing-function: cubic-bezier(0.32, 0.72, 0, 1); transition-duration: 200ms;"
        ></span>
      </button>
    </div>

    <!-- TSA URL -->
    <div class="py-3 border-t border-ink-200 dark:border-ink-800">
      <label for="tsa-url" class="font-medium block">{t('configuracion.tsa.url_label')}</label>
      <p class="text-xs text-ink-500 dark:text-ink-400 mt-0.5 mb-2">
        {t('configuracion.tsa.url_hint')}
      </p>
      <input
        id="tsa-url"
        type="url"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        bind:value={urlDraft}
        onblur={onUrlBlur}
        disabled={!settings.tsaEnabled}
        class="w-full h-11 px-3 rounded-md border bg-ink-50 dark:bg-ink-950 text-ink-900 dark:text-ink-50 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
        class:border-ink-300={!urlError}
        class:dark:border-ink-700={!urlError}
        class:border-err-500={!!urlError}
      />
      {#if urlError}
        <p class="mt-1 text-xs text-err-500" role="alert">{urlError}</p>
      {/if}
      {#if urlDraft.trim() !== DEFAULT_SETTINGS.tsaUrl && !urlError}
        <p class="mt-1 text-xs text-warn-500">
          <span class="i-lucide-alert-triangle align-text-bottom" aria-hidden="true"></span>
          {t('configuracion.tsa.url_csp_warning')}
        </p>
      {/if}
    </div>

    <!-- TSA Timeout -->
    <div class="py-3 border-t border-ink-200 dark:border-ink-800">
      <label for="tsa-timeout" class="font-medium block">
        {t('configuracion.tsa.timeout_label')}
      </label>
      <p class="text-xs text-ink-500 dark:text-ink-400 mt-0.5 mb-2">
        {t('configuracion.tsa.timeout_hint')}
      </p>
      <input
        id="tsa-timeout"
        type="number"
        min="1000"
        max="60000"
        step="500"
        bind:value={timeoutDraft}
        onblur={onTimeoutBlur}
        disabled={!settings.tsaEnabled}
        class="w-32 h-11 px-3 rounded-md border border-ink-300 dark:border-ink-700 bg-ink-50 dark:bg-ink-950 text-ink-900 dark:text-ink-50 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>

    <!-- Probe -->
    <div class="py-4 border-t border-ink-200 dark:border-ink-800 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
      <Button
        variant="outline"
        size="sm"
        onclick={onProbe}
        disabled={!settings.tsaEnabled || probe.status === 'running'}
      >
        {#if probe.status === 'running'}
          <span class="i-lucide-loader-2 text-base animate-spin mr-1.5" aria-hidden="true"></span>
        {:else}
          <span class="i-lucide-zap text-base mr-1.5" aria-hidden="true"></span>
        {/if}
        {probe.status === 'running'
          ? t('configuracion.tsa.probe_running')
          : t('configuracion.tsa.probe_button')}
      </Button>

      {#if probe.status === 'ok'}
        <p class="text-sm text-ok-500" role="status">
          <span class="i-lucide-check-circle align-text-bottom mr-1" aria-hidden="true"></span>
          {t('configuracion.tsa.probe_ok')} · {probe.tsaIssuerCN} · {fmtDate(probe.signingTime)}
        </p>
      {:else if probe.status === 'error'}
        <p class="text-sm text-err-500" role="alert">
          <span class="i-lucide-alert-circle align-text-bottom mr-1" aria-hidden="true"></span>
          {t('configuracion.tsa.probe_error')}: {probe.reason}{probe.detail ? ` (${probe.detail})` : ''}
        </p>
      {/if}
    </div>

    <!-- F7 — LTV section -->
    <div class="pt-6 mt-4 border-t-2 border-ink-200 dark:border-ink-800">
      <header class="flex items-start gap-3 mb-4">
        <span
          class="i-lucide-archive-restore text-2xl text-brand-500 shrink-0 mt-0.5"
          aria-hidden="true"
        ></span>
        <div class="flex-1 min-w-0">
          <h2 class="font-display font-semibold text-lg">
            {t('configuracion.ltv.section_title')}
          </h2>
          <p class="text-sm text-ink-600 dark:text-ink-300 mt-0.5">
            {t('configuracion.ltv.section_lead')}
          </p>
        </div>
      </header>

      <!-- LT toggle -->
      <div
        class="flex items-center justify-between gap-4 py-3 border-t border-ink-200 dark:border-ink-800"
      >
        <div class="flex-1 min-w-0">
          <label for="ltv-enabled" class="font-medium block">
            {t('configuracion.ltv.toggle_lt_label')}
          </label>
          <p class="text-xs text-ink-500 dark:text-ink-400 mt-0.5">
            {t('configuracion.ltv.toggle_lt_desc')}
          </p>
        </div>
        <button
          id="ltv-enabled"
          type="button"
          role="switch"
          aria-checked={settings.ltvEnabled}
          aria-label={t('configuracion.ltv.toggle_lt_label')}
          onclick={onLtvToggle}
          class="relative inline-flex h-11 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
          class:bg-brand-500={settings.ltvEnabled}
          class:bg-ink-300={!settings.ltvEnabled}
          class:dark:bg-ink-700={!settings.ltvEnabled}
        >
          <span
            class="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
            class:translate-x-6={settings.ltvEnabled}
            class:translate-x-1={!settings.ltvEnabled}
            style="transition-timing-function: cubic-bezier(0.32, 0.72, 0, 1); transition-duration: 200ms;"
          ></span>
        </button>
      </div>

      <!-- LTA toggle (disabled when LT off) -->
      <div
        class="flex items-center justify-between gap-4 py-3 border-t border-ink-200 dark:border-ink-800"
        class:opacity-50={!settings.ltvEnabled}
      >
        <div class="flex-1 min-w-0">
          <label for="lta-enabled" class="font-medium block">
            {t('configuracion.ltv.toggle_lta_label')}
          </label>
          <p class="text-xs text-ink-500 dark:text-ink-400 mt-0.5">
            {t('configuracion.ltv.toggle_lta_desc')}
          </p>
        </div>
        <button
          id="lta-enabled"
          type="button"
          role="switch"
          aria-checked={settings.ltvArchiveEnabled && settings.ltvEnabled}
          aria-label={t('configuracion.ltv.toggle_lta_label')}
          disabled={!settings.ltvEnabled}
          onclick={onLtaToggle}
          class="relative inline-flex h-11 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950 disabled:cursor-not-allowed"
          class:bg-brand-500={settings.ltvArchiveEnabled && settings.ltvEnabled}
          class:bg-ink-300={!(settings.ltvArchiveEnabled && settings.ltvEnabled)}
          class:dark:bg-ink-700={!(settings.ltvArchiveEnabled && settings.ltvEnabled)}
        >
          <span
            class="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
            class:translate-x-6={settings.ltvArchiveEnabled && settings.ltvEnabled}
            class:translate-x-1={!(settings.ltvArchiveEnabled && settings.ltvEnabled)}
            style="transition-timing-function: cubic-bezier(0.32, 0.72, 0, 1); transition-duration: 200ms;"
          ></span>
        </button>
      </div>

      <!-- OCSP URL override -->
      <div class="py-3 border-t border-ink-200 dark:border-ink-800">
        <label for="ocsp-url" class="font-medium block">
          {t('configuracion.ltv.ocsp_url_label')}
        </label>
        <p class="text-xs text-ink-500 dark:text-ink-400 mt-0.5 mb-2">
          {t('configuracion.ltv.ocsp_url_hint')}
        </p>
        <input
          id="ocsp-url"
          type="url"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          placeholder="https://ocsp.example.com"
          bind:value={ocspUrlDraft}
          onblur={onOcspUrlBlur}
          disabled={!settings.ltvEnabled}
          class="w-full h-11 px-3 rounded-md border bg-ink-50 dark:bg-ink-950 text-ink-900 dark:text-ink-50 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
          class:border-ink-300={!ocspUrlError}
          class:dark:border-ink-700={!ocspUrlError}
          class:border-err-500={!!ocspUrlError}
        />
        {#if ocspUrlError}
          <p class="mt-1 text-xs text-err-500" role="alert">{ocspUrlError}</p>
        {/if}
        {#if ocspUrlDraft.trim() !== '' && !ocspUrlError}
          <p
            class="mt-1 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5"
            role="note"
            data-test="ltv-csp-hint"
          >
            <span aria-hidden="true">⚠</span>
            <span>{t('configuracion.ltv.ocsp_url_csp_warn')}</span>
          </p>
        {/if}
      </div>

      <!-- LTV Timeout -->
      <div class="py-3 border-t border-ink-200 dark:border-ink-800">
        <label for="ltv-timeout" class="font-medium block">
          {t('configuracion.ltv.timeout_label')}
        </label>
        <p class="text-xs text-ink-500 dark:text-ink-400 mt-0.5 mb-2">
          {t('configuracion.ltv.timeout_hint')}
        </p>
        <input
          id="ltv-timeout"
          type="number"
          min="1000"
          max="60000"
          step="500"
          bind:value={ltvTimeoutDraft}
          onblur={onLtvTimeoutBlur}
          disabled={!settings.ltvEnabled}
          class="w-32 h-11 px-3 rounded-md border border-ink-300 dark:border-ink-700 bg-ink-50 dark:bg-ink-950 text-ink-900 dark:text-ink-50 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      <!-- LTV Probe -->
      <div
        class="py-4 border-t border-ink-200 dark:border-ink-800 flex flex-col sm:flex-row gap-3 items-start sm:items-center"
      >
        <Button
          variant="outline"
          size="sm"
          onclick={onLtvProbe}
          disabled={!settings.ltvEnabled || ltvProbe.status === 'running'}
        >
          {#if ltvProbe.status === 'running'}
            <span
              class="i-lucide-loader-2 text-base animate-spin mr-1.5"
              aria-hidden="true"
            ></span>
          {:else}
            <span class="i-lucide-zap text-base mr-1.5" aria-hidden="true"></span>
          {/if}
          {ltvProbe.status === 'running'
            ? t('configuracion.ltv.probe_running')
            : t('configuracion.ltv.probe_button')}
        </Button>

        {#if ltvProbe.status === 'ok'}
          <p class="text-sm text-ok-500" role="status">
            <span
              class="i-lucide-check-circle align-text-bottom mr-1"
              aria-hidden="true"
            ></span>
            {t('configuracion.ltv.probe_ok')} · {ltvProbe.detail}
          </p>
        {:else if ltvProbe.status === 'error'}
          <p class="text-sm text-err-500" role="alert">
            <span
              class="i-lucide-alert-circle align-text-bottom mr-1"
              aria-hidden="true"
            ></span>
            {t('configuracion.ltv.probe_error')}: {ltvProbe.reason}
          </p>
        {/if}
      </div>
    </div>

    <!-- Reset -->
    <div class="pt-4 border-t border-ink-200 dark:border-ink-800 flex items-center justify-between gap-3">
      <p class="text-xs text-ink-500 dark:text-ink-400" aria-live="polite">
        {#if saved}
          <span class="i-lucide-check align-text-bottom" aria-hidden="true"></span>
          {t('configuracion.saved')}
        {/if}
      </p>
      <Button variant="ghost" size="sm" onclick={onReset}>
        <span class="i-lucide-rotate-ccw text-base mr-1.5" aria-hidden="true"></span>
        {t('configuracion.reset')}
      </Button>
    </div>
  </article>
</section>
