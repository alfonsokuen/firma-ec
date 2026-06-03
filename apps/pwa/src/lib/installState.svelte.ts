/**
 * installState.svelte.ts — estado central de instalación de la PWA.
 *
 * Privacidad (LOPDP por diseño): 100% client-side. No envía nada a ningún
 * servidor, no usa cookies ni terceros. Solo guarda en localStorage un flag
 * de descarte (timestamp) en el propio dispositivo. Sin analítica de embudo.
 *
 * Captura un único `beforeinstallprompt` (Android/Chromium) y expone:
 *  - `canPrompt`  → hay prompt nativo disponible.
 *  - `trigger()`  → punto de entrada del botón "Instalar app": dispara el
 *                   prompt nativo si existe; si no (iOS/Firefox/…), abre la
 *                   guía manual por plataforma.
 *  - helpers de plataforma (isIOS/isAndroid/isStandalone/isIOSNonSafari).
 */

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

    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault(); // evitamos el mini-infobar; usamos UI propia
      this.deferred = e as BeforeInstallPromptEvent;
    });
    window.addEventListener('appinstalled', () => {
      this.installed = true;
      this.deferred = null;
      this.guideOpen = false;
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
