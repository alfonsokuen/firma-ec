<script lang="ts">
/**
 * InstallPrompt.svelte — tarjeta contextual (abajo) que invita a instalar la
 * PWA cuando el navegador (Android/Chromium) ofrece prompt nativo.
 *
 * El evento `beforeinstallprompt` lo captura `installState` (fuente única),
 * para no competir con el botón "Instalar app" del header. Aquí solo se decide
 * cuándo mostrar la tarjeta y se delega el prompt a `installState`.
 *
 * Visibilidad:
 *   - Solo si hay prompt nativo disponible (`installState.canPrompt`).
 *   - Oculta si ya está instalada (standalone) o en rutas de share/handle-file.
 *   - Oculta 30 días tras descartarla (localStorage, en el propio dispositivo).
 *
 * Privacidad (LOPDP): sin tracking; el único dato es el flag local de descarte.
 */
import { t } from '../lib/i18n.svelte.ts';
import { installState } from '../lib/installState.svelte.ts';

const DISMISS_KEY = 'firmar.installPrompt.dismissedAt';
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

let { route }: { route?: string } = $props();

let installing = $state(false);
let dismissed = $state(dismissedRecently());

function dismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number.parseInt(raw, 10);
    if (Number.isNaN(ts)) return false;
    return Date.now() - ts < DISMISS_TTL_MS;
  } catch (_) {
    return false;
  }
}

const hideForRoute = $derived(route === '/share' || route === '/handle-file');

// Invitamos donde la instalación tiene sentido en el teléfono:
//  - Android/Chromium → prompt nativo (un clic).
//  - iOS (Safari o no) → no hay API de instalación (restricción de Apple),
//    así que la tarjeta abre la guía Compartir → "Añadir a pantalla de inicio".
// En desktop/otros navegadores sin prompt nativo no insistimos con la tarjeta
// (igual queda el botón "Instalar app" del header).
const canInvite = $derived(installState.canPrompt || installState.isIOS());
const shouldShow = $derived(
  canInvite && !installState.installed && !dismissed && !hideForRoute,
);

// CTA principal: instala directo si hay prompt nativo; si no (iOS), abre la guía.
async function primary(): Promise<void> {
  if (installState.canPrompt) {
    installing = true;
    const outcome = await installState.prompt();
    installing = false;
    if (outcome === 'dismissed') dismiss();
  } else {
    installState.openGuide();
  }
}

function dismiss(): void {
  dismissed = true;
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch (_) {
    /* noop */
  }
}
</script>

{#if shouldShow}
  <div
    class="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm z-50 rounded-xl border border-ink-200 dark:border-ink-700 bg-ink-50 dark:bg-ink-900 shadow-lg p-4 flex gap-3 animate-in fade-in slide-in-from-bottom-4"
    role="dialog"
    aria-labelledby="install-prompt-title"
    aria-describedby="install-prompt-body"
  >
    <div class="w-10 h-10 rounded-lg bg-brand-500/10 flex-shrink-0 flex items-center justify-center">
      <span class="i-lucide-download text-xl text-brand-500" aria-hidden="true"></span>
    </div>
    <div class="flex-1 min-w-0">
      <p id="install-prompt-title" class="font-semibold text-sm">{t('install.prompt.title')}</p>
      <p id="install-prompt-body" class="text-xs text-ink-600 dark:text-ink-300 mt-0.5">
        {t('install.prompt.body')}
      </p>
      <div class="mt-3 flex items-center gap-2">
        <button
          type="button"
          class="px-3 py-1.5 rounded-md bg-brand-500 hover:bg-brand-600 text-white text-xs font-medium disabled:opacity-50"
          onclick={primary}
          disabled={installing}
        >
          {installing ? '…' : installState.canPrompt ? t('install.prompt.cta') : t('install.prompt.cta_how')}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 rounded-md text-xs text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800"
          onclick={dismiss}
        >
          {t('install.prompt.dismiss')}
        </button>
      </div>
    </div>
    <button
      type="button"
      class="absolute top-2 right-2 p-1 text-ink-500 hover:text-ink-700 dark:hover:text-ink-100"
      aria-label={t('install.prompt.dismiss')}
      onclick={dismiss}
    >
      <span class="i-lucide-x text-base" aria-hidden="true"></span>
    </button>
  </div>
{/if}
