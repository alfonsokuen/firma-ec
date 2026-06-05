<script lang="ts">
import { link } from 'svelte-spa-router';
import { getLang, t } from '../lib/i18n.svelte.ts';
import { installState } from '../lib/installState.svelte.ts';
import Button from '../ui/Button.svelte';
</script>

<!-- Hero — visual parity with apps/landing/src/components/Hero.astro -->
<section
  class="container max-w-6xl mx-auto px-4 py-12 md:py-20"
  aria-labelledby="hero-title"
>
  <p class="text-sm font-mono text-brand-500 mb-4 uppercase tracking-wider">
    {t('hero.eyebrow')}
  </p>
  <h1
    id="hero-title"
    class="font-display text-[clamp(2rem,1.2rem+4vw,4rem)] font-bold leading-[1.05] tracking-[-0.02em] max-w-4xl mb-6"
  >
    {t('hero.title')}
  </h1>
  <p class="max-w-2xl text-base md:text-lg text-ink-600 dark:text-ink-300 mb-7 text-pretty leading-relaxed">
    {t('hero.lead')}
  </p>

  <div class="flex flex-wrap items-center gap-3 mb-10">
    <Button href="/verificar" variant="primary" size="lg">
      {t('hero.cta_primary')}
      <span class="i-lucide-arrow-up-right text-base" aria-hidden="true"></span>
    </Button>
    <Button href="/firmar" variant="outline" size="md">
      {t('hero.cta_secondary')}
      <span class="i-lucide-pen-tool text-base" aria-hidden="true"></span>
    </Button>
    <Button href="https://firmar.ec/" variant="ghost" size="md" external>
      {t('hero.cta_tertiary')}
      <span class="i-lucide-arrow-up-right text-base" aria-hidden="true"></span>
    </Button>
    {#if !installState.installed}
      <Button variant="outline" size="md" onclick={() => installState.trigger()}>
        <span class="i-lucide-download text-base" aria-hidden="true"></span>
        {t('install.menu')}
      </Button>
    {/if}
  </div>

  <!-- Sponsor hook — visible invitation above the trust badges; links to the landing sponsorship page -->
  <div class="mt-2 mb-8 flex flex-wrap items-center gap-x-4 gap-y-2">
    <p class="text-xs font-mono uppercase tracking-wider text-ink-500 dark:text-ink-400 m-0">
      {t('home.sponsor.eyebrow')}
    </p>
    <a
      href={getLang() === 'es' ? 'https://firmar.ec/patrocinar/' : 'https://firmar.ec/en/sponsor/'}
      target="_blank"
      rel="noopener noreferrer"
      class="group inline-flex items-center gap-2 rounded-full border border-dashed border-brand-400/60 dark:border-brand-400/40 bg-brand-500/[0.05] px-3.5 py-1.5 text-sm font-medium text-brand-700 dark:text-brand-300 hover:border-solid hover:bg-brand-500/[0.09] transition-[background-color,border-color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
    >
      <span class="i-lucide-sparkles text-sm text-brand-500" aria-hidden="true"></span>
      <span>{t('home.sponsor.cta')}</span>
      <span class="i-lucide-arrow-up-right text-sm transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true"></span>
    </a>
  </div>

  <!-- Trust badge row — landing parity -->
  <ul class="flex flex-wrap items-center gap-2 text-xs">
    <li>
      <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium font-mono bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200">
        AGPL-3.0
      </span>
    </li>
    <li>
      <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium font-mono bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200">
        ETSI EN 319 142
      </span>
    </li>
    <li>
      <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium font-mono bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200">
        ARCOTEL TSL
      </span>
    </li>
    <li>
      <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium font-mono bg-ok-500/15 text-ok-500">
        LOPDP {getLang() === 'es' ? 'nativa' : 'native'}
      </span>
    </li>
    <li>
      <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium font-mono bg-brand-500/15 text-brand-500">
        100% browser
      </span>
    </li>
  </ul>
</section>

<!-- Action cards — secondary entry to features -->
<section class="container max-w-6xl mx-auto px-4 pb-12" aria-labelledby="actions-title">
  <h2 id="actions-title" class="sr-only">{t('home.title')}</h2>

  <div class="grid gap-4 sm:grid-cols-2">
    <a
      href="/verificar"
      use:link
      class="group p-6 rounded-lg border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 hover:border-brand-400 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_color-mix(in_oklch,oklch(52%_0.18_240)_45%,transparent)] transition-[transform,box-shadow,border-color,background-color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] min-h-44 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
    >
      <div class="w-10 h-10 rounded-md bg-brand-500/10 flex items-center justify-center mb-4 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-105">
        <span class="i-lucide-shield-check text-xl text-brand-500" aria-hidden="true"></span>
      </div>
      <h3 class="font-display text-[clamp(1.125rem,1rem+0.75vw,1.375rem)] font-semibold leading-snug mb-2 flex items-center gap-2 tracking-tight">
        {t('home.verificar')}
        <span class="i-lucide-arrow-right text-base text-brand-500 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1" aria-hidden="true"></span>
      </h3>
      <p class="text-sm text-ink-600 dark:text-ink-300">{t('home.verificar_desc')}</p>
    </a>

    <a
      href="/firmar"
      use:link
      class="group p-6 rounded-lg border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 hover:border-brand-400 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_color-mix(in_oklch,oklch(52%_0.18_240)_45%,transparent)] transition-[transform,box-shadow,border-color,background-color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] min-h-44 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
    >
      <div class="w-10 h-10 rounded-md bg-brand-500/10 flex items-center justify-center mb-4 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-105">
        <span class="i-lucide-pen-tool text-xl text-brand-500" aria-hidden="true"></span>
      </div>
      <h3 class="font-display text-[clamp(1.125rem,1rem+0.75vw,1.375rem)] font-semibold leading-snug mb-2 flex items-center gap-2 tracking-tight">
        {t('home.firmar')}
        <span class="i-lucide-arrow-right text-base text-brand-500 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1" aria-hidden="true"></span>
      </h3>
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
    <h2 id="share-anchor-title" class="font-display text-[clamp(1.25rem,1.1rem+0.9vw,1.625rem)] font-semibold mb-2 tracking-tight">
      {t('home.share_anchor.title')}
    </h2>
    <p class="text-sm text-ink-500 mb-6">{t('home.share_anchor.subtitle')}</p>

    <ol class="grid gap-4 sm:grid-cols-3">
      <li class="p-5 rounded-lg border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900">
        <div class="w-10 h-10 rounded-md bg-brand-500/10 flex items-center justify-center mb-3">
          <span class="i-lucide-share-2 text-xl text-brand-500" aria-hidden="true"></span>
        </div>
        <p class="font-mono text-xs uppercase tracking-wider text-ink-500 mb-1">01</p>
        <p class="text-sm text-ink-600 dark:text-ink-300">{t('home.share_anchor.step1')}</p>
      </li>
      <li class="p-5 rounded-lg border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900">
        <div class="w-10 h-10 rounded-md bg-brand-500/10 flex items-center justify-center mb-3">
          <span class="i-lucide-pen-tool text-xl text-brand-500" aria-hidden="true"></span>
        </div>
        <p class="font-mono text-xs uppercase tracking-wider text-ink-500 mb-1">02</p>
        <p class="text-sm text-ink-600 dark:text-ink-300">{t('home.share_anchor.step2')}</p>
      </li>
      <li class="p-5 rounded-lg border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900">
        <div class="w-10 h-10 rounded-md bg-brand-500/10 flex items-center justify-center mb-3">
          <span class="i-lucide-download text-xl text-brand-500" aria-hidden="true"></span>
        </div>
        <p class="font-mono text-xs uppercase tracking-wider text-ink-500 mb-1">03</p>
        <p class="text-sm text-ink-600 dark:text-ink-300">{t('home.share_anchor.step3')}</p>
      </li>
    </ol>

    <p class="mt-4 text-xs text-ink-500">{t('home.share_anchor.install_hint')}</p>
  </section>
</section>
