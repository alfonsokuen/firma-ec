<script lang="ts">
  import Router from 'svelte-spa-router';
  import { wrap } from 'svelte-spa-router/wrap';
  import type { RouteDefinition, RouteDetailLoaded } from 'svelte-spa-router';
  import Header from './ui/Header.svelte';
  import Footer from './ui/Footer.svelte';
  import Home from './routes/Home.svelte';
  import About from './routes/About.svelte';
  import Firmar from './routes/Firmar.svelte';
  import SharedFileHandler from './routes/SharedFileHandler.svelte';
  import InstallPrompt from './ui/InstallPrompt.svelte';
  import { t } from './lib/i18n.svelte.ts';

  // Eagerly bundled: Home, About, Firmar, SharedFileHandler (small, no-crypto)
  // Lazy via wrap(): Verificar + Paranoia (separate chunks; crypto-heavy deps land in later tasks)
  const routes: RouteDefinition = {
    '/': Home,
    '/verificar': wrap({ asyncComponent: () => import('./routes/Verificar.svelte') }),
    '/firmar': Firmar,
    '/paranoia': wrap({ asyncComponent: () => import('./routes/Paranoia.svelte') }),
    '/about': About,
    // v0.4.0 — OS-delivered PDF entry points (file_handlers + share_target).
    '/share': SharedFileHandler,
    '/handle-file': SharedFileHandler,
    '*': Home,
  };

  // Mirror the hash-router location into a plain reactive string so child
  // components (InstallPrompt) can hide on the share routes.
  let currentRoute = $state('/');
  function onRouteLoaded(detail: RouteDetailLoaded): void {
    currentRoute = detail.location ?? '/';
  }

  // Hide footer on transient OS-handoff routes — they auto-redirect within ~1 frame.
  const showFooter = $derived(currentRoute !== '/share' && currentRoute !== '/handle-file');

  // v0.4.1 — the SW redirects bad shares (no_file, not_pdf, too_big,
  // invalid_pdf, internal) to `/?shareError=<code>`. Forward that into the
  // hash router as `#/share?shareError=<code>` so SharedFileHandler can show
  // a localized error.
  if (typeof window !== 'undefined') {
    try {
      const sp = new URLSearchParams(window.location.search);
      const err = sp.get('shareError');
      if (err) {
        const safe = encodeURIComponent(err);
        // Replace history so the ?shareError= isn't bookmarked.
        window.history.replaceState(null, '', '/');
        window.location.hash = `#/share?shareError=${safe}`;
      }
    } catch (_) {
      /* noop */
    }
  }
</script>

<a href="#main-content" class="skip-link">{t('a11y.skip_to_content')}</a>

<div class="min-h-dvh flex flex-col">
  <Header />
  <main id="main-content" class="flex-1" tabindex="-1">
    <Router {routes} {onRouteLoaded} />
  </main>
  {#if showFooter}
    <Footer />
  {/if}
  <InstallPrompt route={currentRoute} />
</div>

<style>
  .skip-link {
    position: absolute;
    top: 0;
    left: 0;
    transform: translateY(-150%);
    z-index: 100;
    padding: 0.75rem 1.25rem;
    background: var(--brand-500);
    color: white;
    font-weight: 600;
    border-radius: 0 0 0.5rem 0;
    text-decoration: none;
    transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  .skip-link:focus-visible {
    transform: translateY(0);
    outline: 2px solid var(--brand-500);
    outline-offset: 2px;
  }
</style>
