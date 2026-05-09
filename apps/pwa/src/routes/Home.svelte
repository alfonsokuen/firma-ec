<script lang="ts">
  import { link } from 'svelte-spa-router';
  import { t } from '../lib/i18n.svelte.ts';
</script>

<section class="container max-w-3xl mx-auto px-4 py-12 md:py-16">
  <h1 class="text-3xl md:text-4xl font-display font-bold mb-2">{t('home.title')}</h1>
  <p class="text-ink-500 text-lg mb-10">firmar.ec</p>

  <div class="grid gap-4 sm:grid-cols-2">
    <a
      href="/verificar"
      use:link
      class="group p-6 rounded-xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-ink-800 transition-colors min-h-44"
    >
      <div class="w-12 h-12 rounded-lg bg-brand-500/10 flex items-center justify-center mb-4">
        <span class="i-lucide-shield-check text-2xl text-brand-500" aria-hidden="true"></span>
      </div>
      <h2 class="text-xl font-semibold mb-1 flex items-center gap-2">
        {t('home.verificar')}
        <span class="i-lucide-arrow-right text-base text-brand-500 transition-transform group-hover:translate-x-1" aria-hidden="true"></span>
      </h2>
      <p class="text-sm text-ink-600 dark:text-ink-300">{t('home.verificar_desc')}</p>
    </a>

    <a
      href="/firmar"
      use:link
      class="group block p-6 rounded-xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 hover:border-warn-500/50 hover:bg-warn-500/5 transition-colors min-h-44 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
    >
      <div class="w-12 h-12 rounded-lg bg-warn-500/15 flex items-center justify-center mb-4">
        <span class="i-lucide-pen-tool text-2xl text-warn-500" aria-hidden="true"></span>
      </div>
      <h2 class="text-xl font-semibold mb-1 flex items-center gap-2 flex-wrap">
        {t('home.firmar')}
        <span class="px-2 py-0.5 rounded-full text-xs font-mono bg-warn-500/15 text-warn-500">{t('home.firmar_soon')}</span>
      </h2>
      <p class="text-sm text-ink-600 dark:text-ink-300">{t('home.firmar_desc')}</p>
    </a>
  </div>

  <p class="mt-10 text-sm text-ink-600 dark:text-ink-300">
    {t('home.sri_anchor')}
    <span class="block mt-1 text-xs text-ink-500">
      {t('home.aces_count')}
      <a
        class="ml-1 text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 rounded"
        href="https://www.sri.gob.ec/tramites-en-gob-ec"
        target="_blank"
        rel="noopener noreferrer"
      >{t('home.sri_link')}</a>
    </span>
  </p>
</section>
