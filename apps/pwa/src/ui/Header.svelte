<script lang="ts">
  import { link, router } from 'svelte-spa-router';
  import ThemeToggle from './ThemeToggle.svelte';
  import BundleHashBadge from './BundleHashBadge.svelte';
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
</script>

<header class="sticky top-0 z-50 backdrop-blur-md bg-ink-50/85 dark:bg-ink-950/85 border-b border-ink-200/50 dark:border-ink-800/50">
  <nav class="container max-w-6xl mx-auto flex items-center justify-between gap-4 h-14 px-4" aria-label="Navegación principal">
    <a href="/" use:link class="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
      <span class="text-brand-500">firmar</span><span class="text-ink-500">.ec</span>
      <span class="text-xs font-mono text-ink-400 hidden sm:inline">app</span>
    </a>
    <ul class="hidden md:flex items-center gap-1 text-sm font-medium">
      {#each navItems as item}
        <li>
          <a
            href={item.path}
            use:link
            class="px-3 py-2 rounded-md hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors"
            class:text-brand-500={router.location === item.path}
          >
            {t(item.key)}
          </a>
        </li>
      {/each}
    </ul>
    <div class="flex items-center gap-1">
      <BundleHashBadge />
      <button
        type="button"
        onclick={toggleLang}
        aria-label={t('lang.switch')}
        class="inline-flex items-center justify-center w-10 h-10 rounded-md hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors"
      >
        <span class="i-lucide-globe text-base" aria-hidden="true"></span>
        <span class="ml-1 text-xs font-mono">{getLang() === 'es' ? 'EN' : 'ES'}</span>
      </button>
      <ThemeToggle labelToggle={t('theme.toggle')} labelLight="Claro" labelDark="Oscuro" />
    </div>
  </nav>
</header>
