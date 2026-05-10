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
  import ThemeToggle from './ThemeToggle.svelte';
  import { getLang, setLang, t } from '../lib/i18n.svelte.ts';

  const navItems: Array<{ path: string; key: 'nav.home' | 'nav.verificar' | 'nav.firmar' | 'nav.paranoia' | 'nav.about' }> = [
    { path: '/', key: 'nav.home' },
    { path: '/verificar', key: 'nav.verificar' },
    { path: '/firmar', key: 'nav.firmar' },
    { path: '/paranoia', key: 'nav.paranoia' },
    { path: '/about', key: 'nav.about' },
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
      href="/"
      use:link
      onclick={closeMobile}
      class="flex items-center gap-2 font-display text-lg font-bold tracking-tight"
    >
      <span class="text-brand-500">firmar</span><span class="text-ink-500">.ec</span>
      <span class="text-[10px] font-mono text-ink-500 dark:text-ink-400 bg-ink-100 dark:bg-ink-800 px-1.5 py-0.5 rounded hidden sm:inline">app</span>
    </a>

    <ul class="hidden md:flex items-center gap-1 text-sm font-medium">
      {#each navItems as item}
        <li>
          <a
            href={item.path}
            use:link
            class="inline-flex items-center h-11 px-3 rounded-md hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950"
            class:text-brand-500={router.location === item.path}
          >
            {t(item.key)}
          </a>
        </li>
      {/each}
    </ul>

    <div class="flex items-center gap-1">
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
            <a
              href={item.path}
              use:link
              onclick={closeMobile}
              class="flex items-center h-12 px-3 rounded-md hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              class:text-brand-500={router.location === item.path}
            >
              {t(item.key)}
            </a>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</header>
