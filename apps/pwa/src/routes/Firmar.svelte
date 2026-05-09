<script lang="ts">
  /**
   * Firmar.svelte — placeholder route for the F3 signing phase.
   *
   * Communicates roadmap explicitly instead of leaving a disabled tile on Home.
   * No crypto deps loaded here; pure informational page.
   */
  import { link } from 'svelte-spa-router';
  import { t } from '../lib/i18n.svelte.ts';
</script>

<section class="container max-w-2xl mx-auto px-4 py-12 md:py-16">
  <div class="rounded-2xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 px-7 py-8">
    <div class="flex items-start gap-4">
      <div class="shrink-0 w-12 h-12 rounded-xl bg-warn-500/15 flex items-center justify-center" aria-hidden="true">
        <span class="i-lucide-pen-tool text-2xl text-warn-500"></span>
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-xs font-mono uppercase tracking-wide text-warn-500 mb-1">
          {t('firmar.coming_soon')}
        </p>
        <h1 class="text-2xl md:text-3xl font-display font-bold tracking-tight mb-3">
          {t('firmar.title')}
        </h1>
        <p class="text-ink-600 dark:text-ink-300 mb-6">
          {t('firmar.body')}
        </p>
        <div class="flex flex-wrap gap-3">
          <a
            href="https://git.idkmanager.com/alfonso/firma-ec/src/branch/main/docs/superpowers/specs/2026-05-09-firma-ec-F3-firma-MVP-design.md"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 h-11 px-5 rounded-md bg-brand-500 text-white font-medium hover:bg-brand-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
          >
            <span class="i-lucide-file-text text-base" aria-hidden="true"></span>
            {t('firmar.spec_link')}
          </a>
          <a
            href="/"
            use:link
            class="inline-flex items-center gap-2 h-11 px-5 rounded-md border border-ink-300 dark:border-ink-700 bg-ink-50 dark:bg-ink-900 hover:bg-ink-100 dark:hover:bg-ink-800 text-ink-700 dark:text-ink-100 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            <span class="i-lucide-arrow-left text-base" aria-hidden="true"></span>
            {t('firmar.back')}
          </a>
        </div>
      </div>
    </div>
  </div>
</section>
