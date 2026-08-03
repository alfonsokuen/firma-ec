/**
 * swUpdate.svelte.ts — manual Service Worker registration + update-available signal.
 *
 * Why custom: vite-plugin-pwa's auto registerSW.js does `register()` once with
 * no listeners — installed PWAs got stuck on stale versions because nothing
 * detected the new SW in `waiting` state. This module:
 *
 *   1. Registers /sw.js on window load (same as the default).
 *   2. Watches for `updatefound` → new SW reaches `installed` while an old
 *      one is still controlling the page → flip `updateAvailable = true`.
 *   3. Exposes `applyUpdate()` that posts `SKIP_WAITING` to the waiting SW
 *      and reloads the page once `controllerchange` fires.
 *
 * Fresh installs (no previous controller) auto-activate without prompting —
 * `updateAvailable` only flips when there IS something to update FROM.
 *
 * ---------------------------------------------------------------------------
 * Retención de la recarga (`holdReload` / `releaseReload`)
 * ---------------------------------------------------------------------------
 * `sw.ts` hace `skipWaiting()` + `clients.claim()` a propósito — es el arreglo
 * de un cuelgue en móvil en producción y NO se toca. La consecuencia es que un
 * despliegue nuestro activa el SW nuevo solo, dispara `controllerchange` y este
 * módulo recarga la página. Con un documento la ventana son segundos; con una
 * firma POR LOTES son 10-25 minutos, y recargar ahí tira el PIN, la sesión del
 * worker y todos los PDFs ya firmados, que viven únicamente en memoria.
 *
 * Por eso la recarga es retenible: quien arranque trabajo largo llama a
 * {@link holdReload} y lo suelta en un `finally` con {@link releaseReload}.
 * Mientras haya retención NO se recarga y NO se sondea el SW; la versión nueva
 * queda anotada en {@link SwUpdateStore.reloadPending} para que la UI la
 * OFREZCA cuando el lote termine. Ofrecer, nunca ejecutar: al soltar la
 * retención el usuario puede estar mirando el resumen del lote o descargando
 * el ZIP, y una recarga automática ahí destruye exactamente lo que acabamos de
 * proteger.
 */

let registration: ServiceWorkerRegistration | null = null;
let waitingWorker: ServiceWorker | null = null;
let applyingUpdate = false;

/**
 * Retenciones activas de la recarga. Contador y no booleano para que dos
 * trabajos largos solapados (un lote firmando mientras se construye el ZIP) no
 * se pisen: la recarga se libera cuando el ÚLTIMO suelta, no cuando el primero.
 */
let reloadHolds = 0;

/**
 * Espera antes de la recarga de respaldo de {@link applyUpdate}, por si
 * `controllerchange` no llega. Suficiente para que el SW en espera procese
 * `SKIP_WAITING` y reclame los clientes en un móvil lento, y corto como para
 * que el usuario que acaba de pulsar "actualizar" no crea que no pasó nada.
 */
const FALLBACK_RELOAD_DELAY_MS = 3000;

/**
 * Periodo del sondeo de actualizaciones. Una PWA instalada puede pasar días sin
 * comprobar por su cuenta; 20 min es una petición HEAD a `/sw.js` por tercio de
 * hora, coste despreciable frente a servir una versión rancia.
 */
const UPDATE_POLL_INTERVAL_MS = 20 * 60 * 1000;

class SwUpdateStore {
  /** True iff a new SW is installed and waiting for activation. */
  updateAvailable = $state<boolean>(false);
  /** Optional debug info for the UI. */
  registered = $state<boolean>(false);
  /**
   * Una versión nueva ya tomó el control (o el usuario pidió aplicarla) pero la
   * recarga se retuvo porque había trabajo largo en curso. La UI debe OFRECER
   * recargar; este módulo no lo hace por su cuenta.
   */
  reloadPending = $state<boolean>(false);
}

export const swUpdate = new SwUpdateStore();

/**
 * Retiene la recarga automática por actualización del Service Worker.
 *
 * Llámalo antes de empezar trabajo largo cuyo estado vive solo en memoria (la
 * firma por lotes) y suelta SIEMPRE con {@link releaseReload} en un `finally`.
 * Es reentrante: N llamadas exigen N liberaciones.
 */
export function holdReload(): void {
  reloadHolds += 1;
}

/**
 * Suelta una retención tomada con {@link holdReload}. Si había una recarga
 * pendiente NO la ejecuta: queda en {@link SwUpdateStore.reloadPending} para que
 * la UI la ofrezca.
 */
export function releaseReload(): void {
  if (reloadHolds === 0) return; // liberación de más: no debe dejar el contador negativo
  reloadHolds -= 1;
}

/** ¿Hay alguna retención activa? Expuesto para que la UI pueda explicarse. */
export function isReloadHeld(): boolean {
  return reloadHolds > 0;
}

function reloadNow(): void {
  try {
    window.location.reload();
  } catch {
    /* noop */
  }
}

/**
 * Recarga salvo que haya retención; en ese caso lo deja anotado para la UI.
 * Único punto por el que este módulo recarga la página.
 */
function reloadUnlessHeld(): void {
  if (reloadHolds > 0) {
    swUpdate.reloadPending = true;
    return;
  }
  reloadNow();
}

function setWaiting(worker: ServiceWorker | null): void {
  waitingWorker = worker;
  swUpdate.updateAvailable = worker !== null;
}

function watchWorker(worker: ServiceWorker | null): void {
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    // A new SW reaches `installed` while an existing one controls the page.
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      setWaiting(worker);
    }
  });
}

/**
 * Apply the pending update: instruct the waiting SW to skip waiting, then
 * reload the page when it takes control.
 */
export function applyUpdate(): void {
  if (applyingUpdate) return;
  // Con una retención activa ni siquiera se pide el `SKIP_WAITING`: activar el
  // SW nuevo dispararía `controllerchange` y dejaría la pestaña corriendo con un
  // controlador distinto del que sirvió sus chunks, a mitad de un lote.
  if (reloadHolds > 0) {
    swUpdate.reloadPending = true;
    return;
  }
  applyingUpdate = true;
  if (waitingWorker) {
    try {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      applyingUpdate = false;
    }
  }
  // Recarga de respaldo por si `controllerchange` no llega. Vuelve a consultar
  // la retención: pudo empezar un lote durante la espera.
  setTimeout(() => {
    if (applyingUpdate) reloadUnlessHeld();
  }, FALLBACK_RELOAD_DELAY_MS);
}

/**
 * Bootstrap. Call once from main.ts post-mount. Idempotent.
 */
export function initSwUpdate(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (registration) return; // already initialized

  // Reload exactly once when a new SW takes control.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    if (reloadHolds > 0) {
      // Trabajo largo en curso: la versión nueva espera. NO se marca `reloading`
      // — la recarga no ocurrió, así que el "exactamente una vez" sigue intacto.
      swUpdate.reloadPending = true;
      return;
    }
    reloading = true;
    reloadNow();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        registration = reg;
        swUpdate.registered = true;

        // If a SW is already waiting at boot time (user just opened the PWA
        // and a queued update was sitting in `waiting`), surface immediately.
        if (reg.waiting && navigator.serviceWorker.controller) {
          setWaiting(reg.waiting);
        }

        // New SW being installed RIGHT NOW.
        if (reg.installing) {
          watchWorker(reg.installing);
        }

        reg.addEventListener('updatefound', () => {
          watchWorker(reg.installing);
        });

        // Event-driven checks — narrow the window where a cached client
        // keeps serving a stale version after a deploy, without touching the
        // caching strategy in sw.ts itself. Best-effort; a failed check just
        // means we try again on the next trigger or the periodic poll below.
        const checkForUpdate = (): void => {
          // Con `skipWaiting()` + `clients.claim()` en `sw.ts`, encontrar un SW
          // nuevo equivale a que tome el control acto seguido. Sondear con una
          // retención activa es invitar justo al evento que estamos conteniendo;
          // el siguiente disparo (o el sondeo periódico) lo encontrará igual.
          if (reloadHolds > 0) return;
          reg.update().catch(() => {
            /* noop */
          });
        };

        // Tab comes back into view (e.g. switching back from another app).
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate();
        });

        // Page restored from the back/forward cache (bfcache) — a fresh
        // `load` never fires here, so `updatefound` alone would miss it.
        window.addEventListener('pageshow', () => {
          checkForUpdate();
        });

        // Periodic update check — installed PWAs may not check for SW updates
        // for a long time on their own. Cheap (HEAD request to /sw.js).
        setInterval(checkForUpdate, UPDATE_POLL_INTERVAL_MS);
      })
      .catch(() => {
        // Service worker is best-effort; the app works without it.
      });
  });
}
