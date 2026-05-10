<script lang="ts">
  import { link } from 'svelte-spa-router';
  import { t } from '../lib/i18n.svelte.ts';
</script>

<section class="container max-w-3xl mx-auto px-4 py-12 md:py-16">
  <h1 class="text-[clamp(1.875rem,1.4rem+2.4vw,3rem)] font-display font-extrabold tracking-[-0.02em] leading-[1.05] mb-3 text-balance">{t('home.title')}</h1>
  <p class="text-ink-500 text-base md:text-lg mb-10 font-mono tracking-tight">firmar.ec</p>

  <div class="grid gap-4 sm:grid-cols-2">
    <a
      href="/verificar"
      use:link
      class="group p-6 rounded-xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-ink-800 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_color-mix(in_oklch,oklch(52%_0.18_240)_45%,transparent)] transition-[transform,box-shadow,border-color,background-color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] min-h-44 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
    >
      <div class="w-12 h-12 rounded-lg bg-brand-500/10 flex items-center justify-center mb-4 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-105">
        <span class="i-lucide-shield-check text-2xl text-brand-500" aria-hidden="true"></span>
      </div>
      <h2 class="text-xl font-semibold mb-1 flex items-center gap-2 tracking-tight">
        {t('home.verificar')}
        <span class="i-lucide-arrow-right text-base text-brand-500 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1" aria-hidden="true"></span>
      </h2>
      <p class="text-sm text-ink-600 dark:text-ink-300">{t('home.verificar_desc')}</p>
    </a>

    <a
      href="/firmar"
      use:link
      class="group block p-6 rounded-xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 hover:border-warn-500/50 hover:bg-warn-500/5 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_color-mix(in_oklch,oklch(70%_0.16_75)_40%,transparent)] transition-[transform,box-shadow,border-color,background-color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] min-h-44 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
    >
      <div class="w-12 h-12 rounded-lg bg-warn-500/15 flex items-center justify-center mb-4 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-105">
        <span class="i-lucide-pen-tool text-2xl text-warn-500" aria-hidden="true"></span>
      </div>
      <h2 class="text-xl font-semibold mb-1 flex items-center gap-2 flex-wrap tracking-tight">
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

  <!-- v0.4.0 — onboarding: how to receive a PDF straight from WhatsApp/Gmail. -->
  <section class="mt-12 pt-10 border-t border-ink-200 dark:border-ink-800" aria-labelledby="share-anchor-title">
    <h2 id="share-anchor-title" class="text-xl md:text-2xl font-display font-semibold mb-2">
      {t('home.share_anchor.title')}
    </h2>
    <p class="text-sm text-ink-500 mb-6">{t('home.share_anchor.subtitle')}</p>

    <ol class="grid gap-4 sm:grid-cols-3">
      <li class="p-5 rounded-xl border border-ink-200 dark:border-ink-800 bg-ink-50/60 dark:bg-ink-900/40">
        <div class="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center mb-3">
          <span class="i-lucide-share-2 text-xl text-brand-500" aria-hidden="true"></span>
        </div>
        <p class="font-semibold text-sm mb-1">1</p>
        <p class="text-sm text-ink-600 dark:text-ink-300">{t('home.share_anchor.step1')}</p>
      </li>
      <li class="p-5 rounded-xl border border-ink-200 dark:border-ink-800 bg-ink-50/60 dark:bg-ink-900/40">
        <div class="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center mb-3">
          <span class="i-lucide-pen-tool text-xl text-brand-500" aria-hidden="true"></span>
        </div>
        <p class="font-semibold text-sm mb-1">2</p>
        <p class="text-sm text-ink-600 dark:text-ink-300">{t('home.share_anchor.step2')}</p>
      </li>
      <li class="p-5 rounded-xl border border-ink-200 dark:border-ink-800 bg-ink-50/60 dark:bg-ink-900/40">
        <div class="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center mb-3">
          <span class="i-lucide-download text-xl text-brand-500" aria-hidden="true"></span>
        </div>
        <p class="font-semibold text-sm mb-1">3</p>
        <p class="text-sm text-ink-600 dark:text-ink-300">{t('home.share_anchor.step3')}</p>
      </li>
    </ol>

    <p class="mt-4 text-xs text-ink-500">{t('home.share_anchor.install_hint')}</p>
  </section>
</section>
