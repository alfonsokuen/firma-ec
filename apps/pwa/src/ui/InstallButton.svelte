<script lang="ts">
  /**
   * InstallButton.svelte — persistent install affordance for the header.
   *
   * Behaviour matrix:
   *   - Already standalone / installed   → not rendered (returns null).
   *   - Chrome family with deferred event → tap triggers native prompt.
   *   - iOS Safari (no native API)        → tap opens the manual-instructions
   *     dialog (handled by InstallPrompt subscribing to the same store).
   *
   * Tapping ALWAYS clears the 30-day dismissal flag — user expressed intent.
   */
  import { installStore } from '../lib/install.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';

  let { onIosManual }: { onIosManual?: () => void } = $props();

  const visible = $derived(installStore.canShowAny);

  async function onClick(): Promise<void> {
    installStore.clearDismissal();
    if (installStore.canPromptNative) {
      await installStore.promptNative();
      return;
    }
    // iOS or any other no-prompt path: surface the manual instructions card.
    onIosManual?.();
  }
</script>

{#if visible}
  <button
    type="button"
    onclick={onClick}
    aria-label={t('install.button.aria')}
    title={t('install.button.aria')}
    class="inline-flex items-center justify-center h-11 w-11 rounded-md text-brand-600 dark:text-brand-400 hover:bg-brand-500/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
  >
    <span class="i-lucide-download text-base" aria-hidden="true"></span>
  </button>
{/if}
