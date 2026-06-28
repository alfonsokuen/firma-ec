<script lang="ts">
/**
 * Header.svelte — visual parity with `apps/landing/src/components/Header.astro`.
 *
 * Differences vs landing (intentional):
 *  - "app" chip beside lockup so users know they are inside the PWA, not the
 *    institutional site.
 *  - Nav reflects PWA surface (Inicio · Verificar · Firmar · Paranoia · Acerca)
 *    instead of landing IA (Firmar · Verificar · Seguridad · FAQ · Acerca).
 *
 * Everything else matches landing exactly: h-16, sticky+blur, transparent
 * border + scroll-driven 1px shadow, lockup colors, lang+theme toggles.
 */
import { onMount } from 'svelte';
import { link, router } from 'svelte-spa-router';
import { getLang, setLang, t } from '../lib/i18n.svelte.ts';
import { installState } from '../lib/installState.svelte.ts';
import { storeLink } from '../lib/storeLink.ts';
import ThemeToggle from './ThemeToggle.svelte';

/**
 * Nav items. `external: true` opens outside the SPA — used for "Inicio"
 * which deliberately points back to the institutional landing
 * (`firmar.ec`) instead of the PWA `/` route. The logo lockup follows
 * the same rule, so logo-click === Inicio-click === "go to landing".
 */
const LANDING_URL = 'https://firmar.ec/';
const buyUrl = storeLink('header');

const navItems: Array<{
  path: string;
  key:
    | 'nav.home'
    | 'nav.verificar'
    | 'nav.validar_cert'
    | 'nav.firmar'
    | 'nav.paranoia'
    | 'nav.about'
    | 'nav.configuracion';
  external?: boolean;
}> = [
  { path: LANDING_URL, key: 'nav.home', external: true },
  { path: '/firmar', key: 'nav.firmar' },
  { path: '/verificar', key: 'nav.verificar' },
  { path: '/validar-certificado', key: 'nav.validar_cert' },
  { path: '/paranoia', key: 'nav.paranoia' },
  { path: '/about', key: 'nav.about' },
  { path: '/configuracion', key: 'nav.configuracion' },
];

function toggleLang(): void {
  setLang(getLang() === 'es' ? 'en' : 'es');
}

let mobileOpen = $state(false);
let scrolled = $state(false);

function closeMobile(): void {
  mobileOpen = false;
}

onMount(() => {
  function update(): void {
    scrolled = window.scrollY > 8;
  }
  update();
  window.addEventListener('scroll', update, { passive: true });
  return () => window.removeEventListener('scroll', update);
});
</script>

<header
  class="sticky top-0 z-50 backdrop-blur-md bg-ink-50/85 dark:bg-ink-950/85 transition-[box-shadow,border-color,background-color] duration-200 ease-out border-b"
  class:border-transparent={!scrolled}
  class:border-ink-200={scrolled}
  class:dark:border-ink-800={scrolled}
>
  <nav
    class="container max-w-6xl mx-auto flex items-center justify-between gap-4 h-16 px-4"
    aria-label={t('nav.menu')}
  >
    <a
      href={LANDING_URL}
      onclick={closeMobile}
      class="flex shrink-0 items-center gap-2 font-display text-lg font-bold tracking-tight"
    >
      <svg class="h-7 w-7 text-brand-500 shrink-0" viewBox="0 0 100 100" fill="none" aria-hidden="true">
        <path d="M58 22 C40 20, 44 40, 46 56 C48 76, 42 86, 30 80" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M30 48 C46 42, 62 44, 76 52" stroke="#C9821E" stroke-width="7" stroke-linecap="round"/>
      </svg>
      <span><span class="text-brand-500">firmar</span><span style="color:#C9821E">.ec</span></span>
      <span class="text-[10px] font-mono text-ink-500 dark:text-ink-400 bg-ink-100 dark:bg-ink-800 px-1.5 py-0.5 rounded hidden sm:inline">app</span>
    </a>

    <ul class="hidden md:flex items-center gap-1 text-sm font-medium">
      {#each navItems as item}
        <li>
          {#if item.external}
            <a
              href={item.path}
              class="inline-flex items-center h-11 px-3 rounded-md hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
            >
              {t(item.key)}
            </a>
          {:else}
            <a
              href={item.path}
              use:link
              class="inline-flex items-center h-11 px-3 rounded-md hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
              class:text-brand-500={router.location === item.path}
            >
              {t(item.key)}
            </a>
          {/if}
        </li>
      {/each}
    </ul>

    <div class="flex shrink-0 items-center gap-1">
      <!-- Acceso a la tienda SIEMPRE visible en móvil (el botón xl se oculta en móvil). -->
      <a
        href={buyUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-cta="comprar_certificado"
        aria-label={getLang() === 'es' ? 'Comprar certificado' : 'Buy certificate'}
        class="md:hidden inline-flex items-center gap-1 h-9 px-2.5 rounded-md bg-[#C9821E] text-ink-950 text-xs font-bold whitespace-nowrap shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <span class="i-lucide-shopping-bag text-base" aria-hidden="true"></span>
      </a>
      <a
        href={buyUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-cta="comprar_certificado"
        class="hidden xl:inline-flex items-center gap-1.5 h-11 px-3.5 rounded-md bg-[#C9821E] text-ink-950 text-sm font-semibold whitespace-nowrap shadow-sm hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
      >
        <span class="i-lucide-shopping-bag text-base" aria-hidden="true"></span>
        <span>{getLang() === 'es' ? 'Comprar' : 'Buy'}</span>
      </a>
      {#if !installState.installed}
        <button
          type="button"
          onclick={() => installState.trigger()}
          aria-label={t('install.menu')}
          class="hidden md:inline-flex items-center gap-1.5 h-11 px-3 rounded-md text-sm font-medium whitespace-nowrap text-brand-600 dark:text-brand-400 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
        >
          <span class="i-lucide-download text-base" aria-hidden="true"></span>
          <span class="hidden md:inline xl:hidden">{t('install.menu')}</span>
        </button>
      {/if}
      <button
        type="button"
        onclick={toggleLang}
        aria-label={t('lang.switch_to')}
        class="inline-flex items-center justify-center h-11 min-w-11 px-2 rounded-md hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
      >
        <span class="i-lucide-globe text-base" aria-hidden="true"></span>
        <span class="ml-1 text-xs font-mono" aria-hidden="true">{getLang() === 'es' ? 'EN' : 'ES'}</span>
      </button>
      <ThemeToggle labelToggle={t('theme.toggle')} labelLight={t('theme.light')} labelDark={t('theme.dark')} />

      <button
        type="button"
        onclick={() => (mobileOpen = !mobileOpen)}
        aria-label={mobileOpen ? t('nav.menu_close') : t('nav.menu_open')}
        aria-expanded={mobileOpen}
        aria-controls="mobile-nav"
        class="md:hidden inline-flex items-center justify-center h-11 w-11 rounded-md hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
      >
        <span class={mobileOpen ? 'i-lucide-x text-lg' : 'i-lucide-menu text-lg'} aria-hidden="true"></span>
      </button>
    </div>
  </nav>

  {#if mobileOpen}
    <div
      id="mobile-nav"
      class="md:hidden border-t border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-950"
    >
      <ul class="container max-w-6xl mx-auto px-4 py-2 flex flex-col gap-0.5 text-base font-medium">
        {#each navItems as item}
          <li>
            {#if item.external}
              <a
                href={item.path}
                onclick={closeMobile}
                class="flex items-center h-12 px-3 rounded-md hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {t(item.key)}
              </a>
            {:else}
              <a
                href={item.path}
                use:link
                onclick={closeMobile}
                class="flex items-center h-12 px-3 rounded-md hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                class:text-brand-500={router.location === item.path}
              >
                {t(item.key)}
              </a>
            {/if}
          </li>
        {/each}
        <li class="pt-1">
          <a
            href={buyUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-cta="comprar_certificado"
            onclick={closeMobile}
            class="flex items-center justify-center gap-2 h-12 px-3 rounded-md bg-[#C9821E] text-ink-950 font-semibold shadow-sm hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <span class="i-lucide-shopping-bag text-base" aria-hidden="true"></span>
            <span>{getLang() === 'es' ? 'Comprar certificado' : 'Get a certificate'}</span>
          </a>
        </li>
        {#if !installState.installed}
          <li class="pt-1">
            <button
              type="button"
              onclick={() => { installState.trigger(); closeMobile(); }}
              class="w-full flex items-center justify-center gap-1.5 h-12 px-3 rounded-md bg-brand-500 text-white font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <span class="i-lucide-download text-base" aria-hidden="true"></span>
              <span>{t('install.menu')}</span>
            </button>
          </li>
        {/if}
      </ul>
    </div>
  {/if}
</header>
