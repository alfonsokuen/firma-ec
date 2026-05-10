/**
 * settings.svelte.ts — F6 §Task 15
 *
 * Persistent user settings backed by localStorage. Reactive via Svelte 5 runes
 * so any consumer (`getSettings()`) re-renders when settings change.
 *
 * Schema is versioned via the storage key (`firma_ec_settings_v1`). When fields
 * are added with sensible defaults, no migration is needed; only renames or
 * semantic shifts force a key bump.
 *
 * Initially scoped to F6 (TSA toggle / URL / timeout). Future fields land here.
 *
 * SECURITY: this store must NEVER hold secrets — the PIN, P12 bytes, and any
 * decrypted material live only in the worker heap. Settings are user
 * preferences (URLs, toggles), not credentials.
 */

const STORAGE_KEY = 'firma_ec_settings_v1';

/** All persistent user-level settings. */
export interface Settings {
  /** Default-on per spec §Decision 2: every signature is B-T unless opted out. */
  tsaEnabled: boolean;
  /**
   * TSA endpoint URL. Default `https://freetsa.org/tsr` (the only host
   * whitelisted in our default CSP — see Caddyfile.pwa connect-src). Power
   * users targeting a self-hosted TSA must also adjust the deployment CSP.
   */
  tsaUrl: string;
  /** TSA fetch timeout (ms). Default 8000 (matches signer's hardcoded baseline). */
  tsaTimeoutMs: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  tsaEnabled: true,
  tsaUrl: 'https://freetsa.org/tsr',
  tsaTimeoutMs: 8000,
});

/**
 * Defensive load: any malformed/parse-failed/wrong-type value silently falls
 * back to the default. We never throw on read — settings are best-effort UX.
 */
function loadFromStorage(): Settings {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings> | null;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS };
    return {
      tsaEnabled:
        typeof parsed.tsaEnabled === 'boolean' ? parsed.tsaEnabled : DEFAULT_SETTINGS.tsaEnabled,
      tsaUrl:
        typeof parsed.tsaUrl === 'string' && parsed.tsaUrl.length > 0
          ? parsed.tsaUrl
          : DEFAULT_SETTINGS.tsaUrl,
      tsaTimeoutMs:
        typeof parsed.tsaTimeoutMs === 'number' &&
        Number.isFinite(parsed.tsaTimeoutMs) &&
        parsed.tsaTimeoutMs > 0
          ? parsed.tsaTimeoutMs
          : DEFAULT_SETTINGS.tsaTimeoutMs,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let _settings = $state<Settings>(loadFromStorage());

/** Read the current settings (reactive — re-runs in `$derived` / `$effect`). */
export function getSettings(): Readonly<Settings> {
  return _settings;
}

function persist(): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_settings));
  } catch {
    // Quota / private mode — silent. Settings still apply for the current session.
  }
}

/** Patch one or more settings; persists synchronously. */
export function updateSettings(patch: Partial<Settings>): void {
  _settings = { ..._settings, ...patch };
  persist();
}

/** Reset to defaults; clears storage entirely so a future schema migration is clean. */
export function resetSettings(): void {
  _settings = { ...DEFAULT_SETTINGS };
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

/**
 * Validate a TSA URL. Returns null on success, an i18n key on failure.
 * Rules: must parse as URL + protocol must be `https:` (CSP would block
 * anything else anyway, but we surface the error early in the UI).
 */
export function validateTsaUrl(url: string): null | 'configuracion.tsa.url_invalid' | 'configuracion.tsa.url_must_be_https' {
  if (!url || typeof url !== 'string') return 'configuracion.tsa.url_invalid';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'configuracion.tsa.url_invalid';
  }
  if (parsed.protocol !== 'https:') return 'configuracion.tsa.url_must_be_https';
  return null;
}
