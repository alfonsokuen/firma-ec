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
 */

let registration: ServiceWorkerRegistration | null = null;
let waitingWorker: ServiceWorker | null = null;
let applyingUpdate = false;

class SwUpdateStore {
  /** True iff a new SW is installed and waiting for activation. */
  updateAvailable = $state<boolean>(false);
  /** Optional debug info for the UI. */
  registered = $state<boolean>(false);
}

export const swUpdate = new SwUpdateStore();

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
  applyingUpdate = true;
  if (waitingWorker) {
    try {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      applyingUpdate = false;
    }
  }
  // Fallback reload in case `controllerchange` doesn't fire within 3s.
  setTimeout(() => {
    if (applyingUpdate) {
      try { window.location.reload(); } catch { /* noop */ }
    }
  }, 3000);
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
    reloading = true;
    try { window.location.reload(); } catch { /* noop */ }
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

        // Periodic update check — installed PWAs may not check for SW updates
        // for a long time on their own. Poll every 60 min while the app is
        // open. Cheap (HEAD request to /sw.js).
        setInterval(() => {
          reg.update().catch(() => { /* noop */ });
        }, 60 * 60 * 1000);
      })
      .catch(() => {
        // Service worker is best-effort; the app works without it.
      });
  });
}
