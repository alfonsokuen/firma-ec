<script lang="ts">
  /**
   * Footer.svelte — global landmark with copyright, version, privacy claim,
   * and links. Hidden on /share + /handle-file (transient flows).
   *
   * a11y: <footer> implies role="contentinfo" — no extra ARIA needed.
   */
  import { link } from 'svelte-spa-router';
  import { t } from '../lib/i18n.svelte.ts';
  import { APP_VERSION } from '../lib/version.ts';
  import IdkmanagerMark from './IdkmanagerMark.svelte';
</script>

<footer class="border-t border-ink-200/50 dark:border-ink-800/50 bg-ink-50/50 dark:bg-ink-950/50 mt-auto">
  <div class="container max-w-6xl mx-auto px-4 py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-sm text-ink-600 dark:text-ink-400">
    <div class="flex flex-col md:flex-row md:items-center gap-1 md:gap-3">
      <span class="font-medium">{t('footer.copyright')}</span>
      <span class="hidden md:inline text-ink-400 dark:text-ink-600" aria-hidden="true">·</span>
      <span class="font-mono text-xs">
        {t('footer.version_label')} <span class="text-brand-500">{APP_VERSION}</span>
      </span>
      <span class="hidden md:inline text-ink-400 dark:text-ink-600" aria-hidden="true">·</span>
      <a
        href="https://idkmanager.com/"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="IDKMANAGER — idkmanager.com"
        class="inline-flex items-center gap-1.5 text-ink-700 dark:text-ink-300 hover:text-brand-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 rounded"
      >
        <span class="text-[11px] uppercase tracking-wide opacity-70">{t('footer.operated_by')}</span>
        <IdkmanagerMark size="sm" />
      </a>
    </div>

    <p class="text-xs md:text-sm leading-relaxed max-w-md">
      <span class="i-lucide-shield text-ok-500 align-middle inline-block mr-1" aria-hidden="true"></span>
      {t('footer.privacy_claim')}
    </p>

    <nav class="flex flex-wrap items-center gap-1 -mx-2" aria-label="Footer">
      <a
        href="/about"
        use:link
        class="inline-flex items-center min-h-11 min-w-11 px-3 rounded-md hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {t('footer.about_link')}
      </a>
      <a
        href="https://firmar.ec/"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 min-h-11 min-w-11 px-3 rounded-md hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <span>{t('footer.institutional')}</span>
        <span class="i-lucide-arrow-up-right text-base" aria-hidden="true"></span>
      </a>
      <a
        href="https://github.com/idkmanager/firma-ec"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 min-h-11 min-w-11 px-3 rounded-md hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <span class="i-lucide-github text-base" aria-hidden="true"></span>
        <span>{t('footer.github_repo')}</span>
      </a>
    </nav>
  </div>
</footer>
