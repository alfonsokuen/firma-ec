<script lang="ts">
  import Router from 'svelte-spa-router';
  import { wrap } from 'svelte-spa-router/wrap';
  import type { RouteDefinition } from 'svelte-spa-router';
  import Header from './ui/Header.svelte';
  import Home from './routes/Home.svelte';
  import About from './routes/About.svelte';

  // Eagerly bundled: Home, About (fast nav, no crypto weight)
  // Lazy via wrap(): Verificar + Paranoia (separate chunks; crypto-heavy deps land in later tasks)
  const routes: RouteDefinition = {
    '/': Home,
    '/verificar': wrap({ asyncComponent: () => import('./routes/Verificar.svelte') }),
    '/firmar': Home,
    '/paranoia': wrap({ asyncComponent: () => import('./routes/Paranoia.svelte') }),
    '/about': About,
    '*': Home,
  };
</script>

<div class="min-h-dvh flex flex-col">
  <Header />
  <main class="flex-1" tabindex="-1">
    <Router {routes} />
  </main>
</div>
