<script lang="ts">
  /**
   * InstallPrompt.svelte — surfaces the platform-appropriate install UI.
   *
   * Two surfaces sharing one state via `installStore`:
   *   1. Chrome family: auto-shows a bottom card on first deferred prompt
   *      (unless dismissed in last 30d). Tap "Instalar" → native prompt().
   *   2. iOS Safari: bottom card with manual Share Sheet instructions
   *      (only platform path). Auto-shows on first visit; can also be
   *      opened on demand via `forceShow` prop bound from InstallButton.
   *
   * Hidden on /share and /handle-file (UX already in flight).
   * Hidden when running standalone (already installed).
   */
  import { onMount } from 'svelte';
  import { t } from '../lib/i18n.svelte.ts';
  import { installStore } from '../lib/install.svelte.ts';

  let { route, forceShow = $bindable(false) }: { route?: string; forceShow?: boolean } = $props();

  let dismissedThisSession = $state(false);

  onMount(() => {
    installStore.init();
  });

  const hideForRoute = $derived(route === '/share' || route === '/handle-file');

  /** Auto-show when: platform can install, hasn't been dismissed (recent or
   *  this session), and route allows it. Or when forceShow is true (header
   *  button tap), in which case dismissal flag is ignored. */
  const shouldShow = $derived(
    !hideForRoute &&
      !dismissedThisSession &&
      installStore.canShowAny &&
      (forceShow || !installStore.recentlyDismissed),
  );

  async function onInstall(): Promise<void> {
    const outcome = await installStore.promptNative();
    if (outcome === 'accepted' || outcome === 'dismissed') {
      forceShow = false;
      dismissedThisSession = true;
    }
  }

  function onDismiss(): void {
    installStore.dismiss();
    dismissedThisSession = true;
    forceShow = false;
  }
</script>

{#if shouldShow}
  <div
    class="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm z-50 rounded-xl border border-ink-200 dark:border-ink-700 bg-ink-50 dark:bg-ink-900 shadow-lg p-4 animate-in fade-in slide-in-from-bottom-4"
    role="dialog"
    aria-labelledby="install-prompt-title"
    aria-describedby="install-prompt-body"
  >
    <div class="flex gap-3">
      <div class="w-10 h-10 rounded-lg bg-brand-500/10 flex-shrink-0 flex items-center justify-center">
        <span class="i-lucide-download text-xl text-brand-500" aria-hidden="true"></span>
      </div>
      <div class="flex-1 min-w-0">
        {#if installStore.canPromptNative}
          <!-- Chrome family — native prompt available. -->
          <p id="install-prompt-title" class="font-semibold text-sm">
            {t('install.prompt.title')}
          </p>
          <p id="install-prompt-body" class="text-xs text-ink-600 dark:text-ink-300 mt-0.5">
            {t('install.prompt.body')}
          </p>
          <div class="mt-3 flex items-center gap-2">
            <button
              type="button"
              class="px-3 py-1.5 rounded-md bg-brand-500 hover:bg-brand-600 text-white text-xs font-medium"
              onclick={onInstall}
            >
              {t('install.prompt.cta')}
            </button>
            <button
              type="button"
              class="px-3 py-1.5 rounded-md text-xs text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800"
              onclick={onDismiss}
            >
              {t('install.prompt.dismiss')}
            </button>
          </div>
        {:else if installStore.ios}
          <!-- iOS manual instructions — no native API. -->
          <p id="install-prompt-title" class="font-semibold text-sm">
            {t('install.ios.title')}
          </p>
          <p id="install-prompt-body" class="text-xs text-ink-600 dark:text-ink-300 mt-1">
            {t('install.ios.intro')}
          </p>
          <ol class="mt-3 space-y-2 text-xs text-ink-700 dark:text-ink-200">
            <li class="flex items-start gap-2">
              <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-500/10 text-brand-500 font-mono text-[10px] font-semibold flex-shrink-0">1</span>
              <span>
                {t('install.ios.step1')}
                <!-- Inline iOS share icon (SF Symbols "square.and.arrow.up") -->
                <svg viewBox="0 0 24 24" class="inline-block w-3.5 h-3.5 align-text-bottom text-brand-500" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><rect x="4" y="11" width="16" height="10" rx="2"/>
                </svg>
              </span>
            </li>
            <li class="flex items-start gap-2">
              <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-500/10 text-brand-500 font-mono text-[10px] font-semibold flex-shrink-0">2</span>
              <span>{t('install.ios.step2')}</span>
            </li>
            <li class="flex items-start gap-2">
              <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-500/10 text-brand-500 font-mono text-[10px] font-semibold flex-shrink-0">3</span>
              <span>{t('install.ios.step3')}</span>
            </li>
          </ol>
          <div class="mt-3">
            <button
              type="button"
              class="px-3 py-1.5 rounded-md text-xs text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800"
              onclick={onDismiss}
            >
              {t('install.prompt.dismiss')}
            </button>
          </div>
        {/if}
      </div>
      <button
        type="button"
        class="absolute top-2 right-2 p-1 text-ink-500 hover:text-ink-700 dark:hover:text-ink-100"
        aria-label={t('install.prompt.dismiss')}
        onclick={onDismiss}
      >
        <span class="i-lucide-x text-base" aria-hidden="true"></span>
      </button>
    </div>
  </div>
{/if}
