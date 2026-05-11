<script lang="ts">
  /**
   * InstallPrompt.svelte — captures BeforeInstallPromptEvent and surfaces a
   * subtle bottom-anchored card inviting the user to install the PWA so they
   * can receive PDFs straight from WhatsApp / Gmail / Outlook.
   *
   * Visibility rules:
   *   - Hidden on share/handle-file routes (UX is already in flight).
   *   - Hidden if the app is running in standalone display-mode (already installed).
   *   - Hidden for 30 days after dismissal (localStorage flag).
   *   - Hidden if the browser never fires `beforeinstallprompt` (Safari iOS,
   *     Firefox without about:config flag) — those users see the onboarding
   *     section in Home with manual instructions.
   */
  import { onMount } from 'svelte';
  import { t } from '../lib/i18n.svelte.ts';

  interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }

  const DISMISS_KEY = 'firmar.installPrompt.dismissedAt';
  const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  let { route }: { route?: string } = $props();

  let deferred = $state<BeforeInstallPromptEvent | null>(null);
  let visible = $state(false);
  let installing = $state(false);

  function dismissedRecently(): boolean {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (!raw) return false;
      const ts = Number.parseInt(raw, 10);
      if (Number.isNaN(ts)) return false;
      return Date.now() - ts < DISMISS_TTL_MS;
    } catch (_) {
      return false;
    }
  }

  function isStandalone(): boolean {
    try {
      return (
        window.matchMedia?.('(display-mode: standalone)').matches === true ||
        // iOS Safari standalone hint
        (navigator as unknown as { standalone?: boolean }).standalone === true
      );
    } catch (_) {
      return false;
    }
  }

  const hideForRoute = $derived(route === '/share' || route === '/handle-file');
  const shouldShow = $derived(visible && !hideForRoute && deferred !== null);

  onMount(() => {
    if (isStandalone() || dismissedRecently()) return;

    const onBeforeInstall = (e: Event): void => {
      e.preventDefault();
      deferred = e as BeforeInstallPromptEvent;
      visible = true;
    };
    const onInstalled = (): void => {
      visible = false;
      deferred = null;
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  });

  async function install(): Promise<void> {
    if (!deferred) return;
    installing = true;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') {
        visible = false;
      } else {
        dismiss();
      }
    } catch (_) {
      // Some browsers throw if prompt() is called twice; just hide.
      visible = false;
    } finally {
      installing = false;
      deferred = null;
    }
  }

  function dismiss(): void {
    visible = false;
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch (_) {
      /* noop */
    }
  }
</script>

{#if shouldShow}
  <div
    class="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm z-50 rounded-xl border border-ink-200 dark:border-ink-700 bg-ink-50 dark:bg-ink-900 shadow-lg p-4 flex gap-3 animate-in fade-in slide-in-from-bottom-4"
    role="dialog"
    aria-labelledby="install-prompt-title"
    aria-describedby="install-prompt-body"
  >
    <div class="w-10 h-10 rounded-lg bg-brand-500/10 flex-shrink-0 flex items-center justify-center">
      <span class="i-lucide-download text-xl text-brand-500" aria-hidden="true"></span>
    </div>
    <div class="flex-1 min-w-0">
      <p id="install-prompt-title" class="font-semibold text-sm">{t('install.prompt.title')}</p>
      <p id="install-prompt-body" class="text-xs text-ink-600 dark:text-ink-300 mt-0.5">
        {t('install.prompt.body')}
      </p>
      <div class="mt-3 flex items-center gap-2">
        <button
          type="button"
          class="px-3 py-1.5 rounded-md bg-brand-500 hover:bg-brand-600 text-white text-xs font-medium disabled:opacity-50"
          onclick={install}
          disabled={installing}
        >
          {installing ? '…' : t('install.prompt.cta')}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 rounded-md text-xs text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800"
          onclick={dismiss}
        >
          {t('install.prompt.dismiss')}
        </button>
      </div>
    </div>
    <button
      type="button"
      class="absolute top-2 right-2 p-1 text-ink-500 hover:text-ink-700 dark:hover:text-ink-100"
      aria-label={t('install.prompt.dismiss')}
      onclick={dismiss}
    >
      <span class="i-lucide-x text-base" aria-hidden="true"></span>
    </button>
  </div>
{/if}
