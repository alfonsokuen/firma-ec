/**
 * install.svelte.ts — shared PWA install state + helpers.
 *
 * Why a singleton: both the floating InstallPrompt toast and the persistent
 * InstallButton in the header need to know the same state (was beforeinstallprompt
 * fired? are we standalone? did the user dismiss recently?) and trigger the
 * same prompt() call. Two components subscribing to one source of truth keeps
 * them in lockstep — when the user installs via the toast, the header icon
 * disappears too without a second event roundtrip.
 *
 * Platforms:
 *   - Chrome/Edge/Brave/Opera (Android + Desktop) — fire `beforeinstallprompt`,
 *     can prompt() programmatically.
 *   - Safari iOS / iPadOS — NO `beforeinstallprompt`, install only via the
 *     Share Sheet → "Add to Home Screen". We detect iOS+Safari to surface
 *     dedicated visual instructions instead.
 *   - Firefox — no `beforeinstallprompt` by default; users see the toast hint
 *     but the prompt() never fires. We treat them like iOS (manual hint).
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'firmar.installPrompt.dismissedAt';
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function dismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number.parseInt(raw, 10);
    if (Number.isNaN(ts)) return false;
    return Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

function detectIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iOS (iPhone, iPad, iPod). iPadOS 13+ reports MacIntel platform with touch
  // points — second check catches that.
  const iosish = /iPhone|iPad|iPod/i.test(ua);
  const iPadOsModern =
    /Macintosh/i.test(ua) &&
    typeof (navigator as { maxTouchPoints?: number }).maxTouchPoints === 'number' &&
    ((navigator as { maxTouchPoints?: number }).maxTouchPoints ?? 0) > 1;
  return iosish || iPadOsModern;
}

class InstallStore {
  /** Captured `beforeinstallprompt` (Chrome family only). */
  deferred = $state<BeforeInstallPromptEvent | null>(null);
  /** True iff the app is running standalone (already installed). */
  standalone = $state<boolean>(false);
  /** True iff platform is iOS / iPadOS (no beforeinstallprompt support). */
  ios = $state<boolean>(false);
  /** True iff the user dismissed recently (< 30d). */
  recentlyDismissed = $state<boolean>(false);
  /** True after install() resolves accepted (or appinstalled fires). */
  installed = $state<boolean>(false);

  private bound = false;

  init(): void {
    if (typeof window === 'undefined' || this.bound) return;
    this.bound = true;
    this.standalone = isStandalone();
    this.ios = detectIos();
    this.recentlyDismissed = dismissedRecently();

    const onBeforeInstall = (e: Event): void => {
      e.preventDefault();
      this.deferred = e as BeforeInstallPromptEvent;
    };
    const onInstalled = (): void => {
      this.installed = true;
      this.deferred = null;
      this.standalone = true;
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
  }

  /** Can we surface ANY install affordance to this user? */
  get canShowAny(): boolean {
    if (this.standalone || this.installed) return false;
    // iOS: always show (only path is manual). Others: only when prompt is available.
    return this.ios || this.deferred !== null;
  }

  /** Can we trigger a native prompt programmatically? */
  get canPromptNative(): boolean {
    return !this.standalone && !this.installed && this.deferred !== null;
  }

  async promptNative(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!this.deferred) return 'unavailable';
    try {
      await this.deferred.prompt();
      const choice = await this.deferred.userChoice;
      this.deferred = null;
      if (choice.outcome === 'accepted') {
        this.installed = true;
        this.standalone = true;
      }
      return choice.outcome;
    } catch {
      this.deferred = null;
      return 'unavailable';
    }
  }

  dismiss(): void {
    this.recentlyDismissed = true;
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* noop */
    }
  }

  /** Clear the dismissed flag — used when the user explicitly taps the header
   *  install button (intent: "I changed my mind"). */
  clearDismissal(): void {
    this.recentlyDismissed = false;
    try {
      localStorage.removeItem(DISMISS_KEY);
    } catch {
      /* noop */
    }
  }
}

export const installStore = new InstallStore();
