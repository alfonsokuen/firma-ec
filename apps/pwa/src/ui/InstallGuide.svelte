<script lang="ts">
/**
 * InstallGuide.svelte — hoja de instrucciones manuales de instalación.
 *
 * Se abre desde el botón "Instalar app" cuando NO hay prompt nativo
 * (iOS Safari, Firefox, navegadores iOS no-Safari, etc.). Muestra los
 * pasos correctos según la plataforma. 100% client-side, sin tracking.
 */
import { t } from '../lib/i18n.svelte.ts';
import { installState } from '../lib/installState.svelte.ts';

const open = $derived(installState.guideOpen);

function close(): void {
  installState.closeGuide();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close();
}
</script>

<svelte:window onkeydown={open ? onKey : undefined} />

{#if open}
  <!-- backdrop -->
  <div
    class="fixed inset-0 z-[60] bg-ink-950/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
    role="presentation"
    onclick={close}
  >
    <!-- card / bottom sheet -->
    <div
      class="w-full sm:max-w-md bg-ink-50 dark:bg-ink-900 rounded-t-2xl sm:rounded-2xl border border-ink-200 dark:border-ink-700 shadow-xl p-5 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-guide-title"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-lg bg-brand-500/10 flex-shrink-0 flex items-center justify-center">
          <span class="i-lucide-download text-xl text-brand-500" aria-hidden="true"></span>
        </div>
        <div class="flex-1 min-w-0">
          <h2 id="install-guide-title" class="font-display text-lg font-bold tracking-tight">
            {t('install.guide.title')}
          </h2>
          <p class="text-sm text-ink-600 dark:text-ink-300 mt-1">{t('install.guide.value')}</p>
        </div>
        <button
          type="button"
          class="p-1 -mr-1 -mt-1 text-ink-500 hover:text-ink-700 dark:hover:text-ink-100 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          aria-label={t('install.guide.close')}
          onclick={close}
        >
          <span class="i-lucide-x text-base" aria-hidden="true"></span>
        </button>
      </div>

      <div class="mt-5">
        {#if installState.canPrompt}
          <button
            type="button"
            class="w-full inline-flex items-center justify-center gap-2 h-12 rounded-md bg-brand-500 hover:bg-brand-600 text-white font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            onclick={() => installState.prompt()}
          >
            <span class="i-lucide-download text-base" aria-hidden="true"></span>
            {t('install.guide.android_cta')}
          </button>
        {:else if installState.isIOSNonSafari()}
          <p class="text-sm text-ink-700 dark:text-ink-200 bg-amber-500/10 border border-amber-500/30 rounded-md p-3">
            {t('install.guide.ios_nonsafari')}
          </p>
        {:else if installState.isIOS()}
          <p class="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-3">
            {t('install.guide.ios_title')}
          </p>
          <ol class="flex flex-col gap-3">
            <li class="flex items-center gap-3">
              <span class="w-6 h-6 flex-shrink-0 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center">1</span>
              <span class="text-sm flex items-center gap-1.5">
                {t('install.guide.ios_step1')}
                <!-- glifo Compartir de iOS (cuadro + flecha arriba) -->
                <svg viewBox="0 0 24 24" class="w-5 h-5 inline-block text-brand-500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>
                </svg>
              </span>
            </li>
            <li class="flex items-center gap-3">
              <span class="w-6 h-6 flex-shrink-0 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center">2</span>
              <span class="text-sm">{t('install.guide.ios_step2')}</span>
            </li>
            <li class="flex items-center gap-3">
              <span class="w-6 h-6 flex-shrink-0 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center">3</span>
              <span class="text-sm">{t('install.guide.ios_step3')}</span>
            </li>
          </ol>
        {:else if installState.isAndroid()}
          <p class="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-3">
            {t('install.guide.android_title')}
          </p>
          <ol class="flex flex-col gap-3">
            <li class="flex items-center gap-3">
              <span class="w-6 h-6 flex-shrink-0 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center">1</span>
              <span class="text-sm flex items-center gap-1.5">
                {t('install.guide.android_step1')}
                <!-- glifo menú ⋮ -->
                <svg viewBox="0 0 24 24" class="w-5 h-5 inline-block text-brand-500" fill="currentColor" aria-hidden="true">
                  <circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>
                </svg>
              </span>
            </li>
            <li class="flex items-center gap-3">
              <span class="w-6 h-6 flex-shrink-0 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center">2</span>
              <span class="text-sm">{t('install.guide.android_step2')}</span>
            </li>
            <li class="flex items-center gap-3">
              <span class="w-6 h-6 flex-shrink-0 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center">3</span>
              <span class="text-sm">{t('install.guide.android_step3')}</span>
            </li>
          </ol>
          <p class="mt-4 text-xs text-ink-500">{t('install.guide.android_note')}</p>
        {:else}
          <p class="text-sm text-ink-700 dark:text-ink-200 bg-ink-100 dark:bg-ink-800 rounded-md p-3">
            {t('install.guide.generic')}
          </p>
        {/if}
      </div>

      <button
        type="button"
        class="mt-5 w-full h-11 rounded-md border border-ink-200 dark:border-ink-700 text-sm font-medium hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        onclick={close}
      >
        {t('install.guide.close')}
      </button>
    </div>
  </div>
{/if}
