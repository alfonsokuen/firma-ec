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

    <button
      type="button"
      disabled
      class="text-left p-6 rounded-xl border border-ink-200 dark:border-ink-800 bg-ink-100 dark:bg-ink-900 opacity-60 cursor-not-allowed min-h-44"
    >
      <div class="w-12 h-12 rounded-lg bg-ink-300/30 flex items-center justify-center mb-4">
        <span class="i-lucide-pen-tool text-2xl text-ink-400" aria-hidden="true"></span>
      </div>
      <h2 class="text-xl font-semibold mb-1 flex items-center gap-2">
        {t('home.firmar')}
        <span class="px-2 py-0.5 rounded-full text-xs font-mono bg-warn-500/15 text-warn-500">{t('home.firmar_soon')}</span>
      </h2>
      <p class="text-sm text-ink-600 dark:text-ink-300">{t('home.firmar_desc')}</p>
    </button>
  </div>
</section>
