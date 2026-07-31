<script lang="ts">
import { onMount } from 'svelte';
import Router from 'svelte-spa-router';
import type { RouteDefinition, RouteDetailLoaded } from 'svelte-spa-router';
import { t } from './lib/i18n.svelte.ts';
import { installState } from './lib/installState.svelte.ts';
import { wrap } from 'svelte-spa-router/wrap';
import About from './routes/About.svelte';
import Firmar from './routes/Firmar.svelte';
import Home from './routes/Home.svelte';
import SharedFileHandler from './routes/SharedFileHandler.svelte';
import Footer from './ui/Footer.svelte';
import Header from './ui/Header.svelte';
import InstallGuide from './ui/InstallGuide.svelte';
import InstallPrompt from './ui/InstallPrompt.svelte';
import UpdateNotification from './ui/UpdateNotification.svelte';

// Eagerly bundled: Home, About, Firmar, SharedFileHandler (small, no-crypto)
// Lazy via wrap(): Verificar + Paranoia (separate chunks; crypto-heavy deps land in later tasks)
const routes: RouteDefinition = {
  '/': Home,
  '/verificar': wrap({ asyncComponent: () => import('./routes/Verificar.svelte') }),
  '/validar-certificado': wrap({
    asyncComponent: () => import('./routes/ValidarCertificado.svelte'),
  }),
  '/firmar': Firmar,
  // F1 modo guiado — misma máquina de estados de Firmar, renderers guiados por paso.
  '/firmar-facil': wrap({ component: Firmar, props: { guided: true } }),
  // Firma por lotes — lazy: arrastra el motor de cola + el escritor de ZIP, que
  // no tienen por qué pesar en el arranque de quien solo firma un documento.
  '/firmar-lote': wrap({ asyncComponent: () => import('./routes/FirmarLote.svelte') }),
  '/paranoia': wrap({ asyncComponent: () => import('./routes/Paranoia.svelte') }),
  '/about': About,
  // v0.4.0 — OS-delivered PDF entry points (file_handlers + share_target).
  '/share': SharedFileHandler,
  '/handle-file': SharedFileHandler,
  // F3.5 — WhatsApp inbox (lazy: crypto + decrypt land here, not base entry).
  '/inbox': wrap({ asyncComponent: () => import('./routes/Inbox.svelte') }),
  // F6 — settings (TSA toggle / URL / timeout). Lazy: pulls @firma-ec/tsa-client for the probe.
  '/configuracion': wrap({ asyncComponent: () => import('./routes/Configuracion.svelte') }),
  // F9 — compra/emisión de certificados (ArgosData/Signare). Lazy: chunk aparte,
  // no infla el bundle base. Preview: lista planes; checkout en F9.0c.
  '/certificados': wrap({ asyncComponent: () => import('./routes/Certificados.svelte') }),
  '/certificados/comprar': wrap({
    asyncComponent: () => import('./routes/ComprarCertificado.svelte'),
  }),
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

// Captura única del evento de instalación (Chromium) + detección de plataforma.
// Si se llega con ?install=1 (botón "Instalar app" del landing, otro origen),
// abrimos la guía: su botón "Instalar ahora" es un gesto de usuario válido para
// lanzar el prompt nativo (auto-disparar prompt() sin gesto lo bloquea Chrome).
onMount(() => {
  installState.start();
  try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('install') === '1') {
      // Instalación auto: el diálogo nativo salta en el primer gesto del
      // usuario (Chrome lo exige); las indicaciones quedan de referencia.
      if (!installState.installed) installState.armAutoInstall();
      // Limpiar el query para no re-armar al recargar/compartir.
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
  } catch (_) {
    /* noop */
  }
});

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
  <InstallGuide />
  <UpdateNotification />
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
