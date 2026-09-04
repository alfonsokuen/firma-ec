<script lang="ts">
import { t } from '../lib/i18n.svelte.ts';
/**
 * UpdateNotification.svelte — toast shown when a new SW is installed and
 * waiting to activate. Tap "Recargar" → SKIP_WAITING → controllerchange →
 * page reloads with the new version.
 *
 * Visibility: only when swUpdate.updateAvailable === true. Auto-dismisses
 * after the user taps reload (page navigates away).
 */
import { applyUpdate, reloadOnUserRequest, swUpdate } from '../lib/swUpdate.svelte.ts';

let applying = $state(false);

/**
 * Con `skipWaiting()` + `clients.claim()` en `sw.ts`, un despliegue rara vez
 * deja un SW en `waiting`: toma el control solo. Si en ese momento había
 * trabajo a medias la recarga se RETIENE (`reloadPending`) — y sin este caso
 * el aviso no aparecería nunca, dejando la versión nueva inaplicable mientras
 * la pestaña siguiera abierta.
 */
const held = $derived(swUpdate.reloadPending);

function onReload(): void {
  if (applying) return;
  applying = true;
  // Retenida: el SW nuevo YA controla la página, no hay a quién pedirle
  // `SKIP_WAITING` — solo queda recargar, y lo pide el usuario.
  if (held) reloadOnUserRequest();
  else applyUpdate();
}
</script>

{#if swUpdate.updateAvailable || held}
  <div
    class="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm z-[60] rounded-xl border border-brand-400 dark:border-brand-500 bg-brand-50 dark:bg-brand-900 shadow-lg p-4 animate-in fade-in slide-in-from-bottom-4"
    role="status"
    aria-live="polite"
    aria-labelledby="sw-update-title"
  >
    <div class="flex gap-3 items-start">
      <div class="w-10 h-10 rounded-lg bg-brand-500/15 flex-shrink-0 flex items-center justify-center">
        <span class="i-lucide-refresh-cw text-xl text-brand-600 dark:text-brand-300" aria-hidden="true"></span>
      </div>
      <div class="flex-1 min-w-0">
        <p id="sw-update-title" class="font-semibold text-sm text-ink-900 dark:text-ink-50">
          {held ? t('sw.update.held.title') : t('sw.update.title')}
        </p>
        <p class="text-xs text-ink-700 dark:text-ink-200 mt-0.5">
          {held ? t('sw.update.held.body') : t('sw.update.body')}
        </p>
        <div class="mt-3">
          <button
            type="button"
            class="px-3 py-1.5 rounded-md bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold disabled:opacity-50"
            onclick={onReload}
            disabled={applying}
          >
            {applying ? t('sw.update.applying') : t('sw.update.cta')}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
