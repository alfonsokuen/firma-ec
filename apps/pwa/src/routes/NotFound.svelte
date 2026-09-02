<script lang="ts">
import { onMount } from 'svelte';
import { t } from '../lib/i18n.svelte.ts';
import { sanitizeAttemptedPath } from '../lib/pathAlias.ts';

/**
 * Pantalla de "no encontrado". Hasta el 2026-09-02 el comodín del router y el
 * puente de alias mandaban cualquier ruta desconocida a la Home con 200: un
 * sumidero MUDO que dejó vivir meses cuatro rutas rotas que las páginas
 * anunciaban. Esta pantalla existe para que un fallo de ruta se VEA, y para
 * que un canary o un monitor puedan afirmar sobre un texto.
 *
 * El path intentado llega en la query del hash (`#/no-encontrado?p=/lo-que-sea`).
 * Solo se pinta si PARECE un path (`sanitizeAttemptedPath`): esta pantalla
 * refleja texto en un dominio de confianza, y sin filtro `?p=Llame+al+0999...`
 * pintaba una instrucción de phishing bajo la marca. Svelte escapa el HTML, pero
 * el problema no era HTML, era el texto mismo (CWE-451).
 *
 * Se relee en cada `hashchange`: `'/no-encontrado'` y `'*'` apuntan al mismo
 * componente, así que el router lo REUTILIZA al pasar de una ruta muerta a
 * otra y `onMount` no vuelve a correr. Leerlo una sola vez hacía que un canary
 * que recorriera varias rutas muertas en la misma sesión leyera siempre la
 * primera y diera verde para todas: el detector que miente, otra vez.
 */
let attempted = $state<string | null>(null);

function readAttempted(): string | null {
  try {
    const hash = window.location.hash ?? '';
    const q = hash.indexOf('?');
    const p = q === -1 ? null : new URLSearchParams(hash.slice(q + 1)).get('p');
    // Sin `?p=` (ruta hash desconocida, p. ej. `#/verify`) se muestra el hash,
    // que pasa por el mismo filtro.
    const raw = p ?? (q === -1 ? hash : hash.slice(0, q)).replace(/^#/, '');
    return sanitizeAttemptedPath(raw);
  } catch {
    return null;
  }
}

onMount(() => {
  attempted = readAttempted();
  const onHash = () => {
    attempted = readAttempted();
  };
  window.addEventListener('hashchange', onHash);
  return () => window.removeEventListener('hashchange', onHash);
});
</script>

<section class="container max-w-2xl mx-auto px-4 py-12" aria-labelledby="notfound-title">
  <h1 id="notfound-title" class="text-3xl font-display font-bold mb-4">{t('notfound.title')}</h1>
  <p class="text-ink-600 dark:text-ink-300 mb-4">{t('notfound.body')}</p>
  {#if attempted}
    <p class="text-sm text-ink-600 dark:text-ink-400 mb-6">
      {t('notfound.path_label')}:
      <code class="font-mono text-brand-500 break-all">{attempted}</code>
    </p>
  {/if}
  <a
    href="#/"
    data-testid="notfound-home"
    class="inline-flex items-center gap-2 h-11 px-5 rounded-md bg-brand-500 text-white font-medium hover:bg-brand-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
  >
    <span class="i-lucide-arrow-left text-base" aria-hidden="true"></span>
    {t('notfound.cta_home')}
  </a>
</section>
