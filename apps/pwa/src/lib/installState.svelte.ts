/**
 * installState.svelte.ts — estado central de instalación de la PWA.
 *
 * Privacidad (LOPDP por diseño): sin cookies, sin terceros, sin identificador.
 * El flag de descarte vive en localStorage, en el propio dispositivo.
 *
 * ÚNICA salida de red (2026-08-24): al completarse `appinstalled` se incrementa
 * un contador global anónimo (`pingUsage('install')`), del mismo tipo que los
 * contadores públicos de firmas y verificaciones ya publicados en /estadisticas/.
 * Es un entero por instalación: sin payload, sin identificador, sin secuencia.
 * NO es analítica de embudo — no se puede reconstruir el recorrido de nadie —
 * y responde a la única pregunta que hoy no tiene respuesta: si la app se instala.
 *
 * Captura un único `beforeinstallprompt` (Android/Chromium) y expone:
 *  - `canPrompt`  → hay prompt nativo disponible.
 *  - `trigger()`  → punto de entrada del botón "Instalar app": dispara el
 *                   prompt nativo si existe; si no (iOS/Firefox/…), abre la
 *                   guía manual por plataforma.
 *  - helpers de plataforma (isIOS/isAndroid/isStandalone/isIOSNonSafari).
 */

import { pingUsage } from './statsBeacon';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

class InstallState {
  /** Evento nativo diferido (solo Chromium). */
  deferred = $state<BeforeInstallPromptEvent | null>(null);
  /** La app ya está instalada / corriendo en standalone. */
  installed = $state(false);
  /** La hoja de guía manual está abierta. */
  guideOpen = $state(false);

  #started = false;

  /** Llamar una vez (App.svelte onMount). Idempotente y SSR-safe. */
  start(): void {
    if (this.#started || typeof window === 'undefined') return;
    this.#started = true;
    if (this.isStandalone()) this.installed = true;

    // El evento `beforeinstallprompt` suele dispararse ANTES de que Svelte
    // monte; un script inline en <head> (index.html) lo retiene en
    // window.__deferredBIP. Lo recogemos aquí para no perderlo.
    const early = (window as unknown as { __deferredBIP?: Event | null }).__deferredBIP;
    if (early) this.deferred = early as BeforeInstallPromptEvent;

    // Seguimos escuchando por si Chrome lo re-emite más tarde (cambia la
    // heurística de engagement, vuelve a estar elegible, etc.).
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault(); // evitamos el mini-infobar; usamos UI propia
      this.deferred = e as BeforeInstallPromptEvent;
    });
    window.addEventListener('appinstalled', () => {
      this.installed = true;
      this.deferred = null;
      this.guideOpen = false;
      // Contador global anónimo (ver cabecera). Fire-and-forget: pingUsage se
      // traga cualquier fallo, así que no puede romper la instalación.
      pingUsage('install');
    });
  }

  get canPrompt(): boolean {
    return this.deferred !== null;
  }

  /** Dispara el prompt nativo (Chromium). Devuelve el resultado. */
  async prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    const d = this.deferred;
    if (!d) return 'unavailable';
    try {
      await d.prompt();
      const choice = await d.userChoice;
      this.deferred = null;
      if (choice.outcome === 'accepted') this.installed = true;
      return choice.outcome;
    } catch (_) {
      this.deferred = null;
      return 'dismissed';
    }
  }

  /** Acción del botón "Instalar app": nativo si se puede, si no guía manual. */
  async trigger(): Promise<void> {
    if (this.canPrompt) {
      await this.prompt();
    } else {
      this.guideOpen = true;
    }
  }

  /**
   * Instalación "auto" al llegar con ?install=1 (desde el landing).
   * Chrome exige un gesto del usuario para abrir el diálogo nativo — no se
   * puede disparar solo al cargar. Por eso armamos el disparo en el PRIMER
   * gesto del usuario: así el diálogo nativo salta de inmediato sin mostrarle
   * antes los pasos manuales. En iOS no existe prompt nativo → abrimos la guía
   * (las indicaciones quedan solo como referencia). Si tras unos segundos no
   * hay prompt nativo disponible, mostramos la guía como red de seguridad.
   */
  armAutoInstall(): void {
    if (typeof window === 'undefined' || this.installed) return;
    if (this.isIOS()) {
      this.openGuide();
      return;
    }
    let done = false;
    const cleanup = (): void => {
      done = true;
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
      clearTimeout(timer);
    };
    const onGesture = (): void => {
      if (done || this.installed) {
        cleanup();
        return;
      }
      // Solo consumimos el gesto cuando el prompt nativo ya está disponible;
      // si aún no llegó el evento, seguimos escuchando el siguiente gesto.
      if (this.canPrompt) {
        cleanup();
        void this.prompt();
      }
    };
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
    const timer = setTimeout(() => {
      if (!done && !this.installed && !this.canPrompt) {
        cleanup();
        this.openGuide(); // sin prompt nativo: indicaciones como referencia
      }
    }, 10000);
  }

  openGuide(): void {
    this.guideOpen = true;
  }
  closeGuide(): void {
    this.guideOpen = false;
  }

  isStandalone(): boolean {
    try {
      return (
        window.matchMedia?.('(display-mode: standalone)').matches === true ||
        (navigator as unknown as { standalone?: boolean }).standalone === true
      );
    } catch (_) {
      return false;
    }
  }

  isIOS(): boolean {
    try {
      const ua = navigator.userAgent;
      // iPadOS 13+ se reporta como MacIntel con touch.
      return (
        /iphone|ipad|ipod/i.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      );
    } catch (_) {
      return false;
    }
  }

  isAndroid(): boolean {
    try {
      return /android/i.test(navigator.userAgent);
    } catch (_) {
      return false;
    }
  }

  /** iOS en un navegador que NO es Safari (Chrome/Firefox/Edge iOS no instalan). */
  isIOSNonSafari(): boolean {
    try {
      return this.isIOS() && /crios|fxios|edgios|opios/i.test(navigator.userAgent);
    } catch (_) {
      return false;
    }
  }
}

export const installState = new InstallState();
