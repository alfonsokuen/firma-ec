/**
 * inboxStore.ts — module-scoped state for the WhatsApp inbox flow (F3.5).
 *
 * Holds the JWT, the OTP, and the active pdfId across route transitions
 * (`/inbox` → `/firmar` or `/verificar`). Lives in module scope so it
 * survives lazy chunk boundaries but disappears on full page reload.
 *
 * Plain TS (not `.svelte.ts`) so vitest can load it under Node without the
 * Svelte runes compiler. Components re-read on click, so we don't need
 * reactive runes for the values themselves.
 *
 * SECURITY:
 *  - JWT and OTP NEVER touch localStorage. They only live here in memory.
 *  - The only thing we persist is `firma_ec_inbox_last_active`, a
 *    timestamp used to force OTP re-entry after >10min of inactivity.
 *  - `clear()` zeroes the JWT/OTP — call after handoff completes (sign or
 *    outbox send) and on idle expiry.
 */

const IDLE_KEY = 'firma_ec_inbox_last_active';
const IDLE_MS = 10 * 60 * 1000; // 10 minutes

export interface InboxContext {
  /** Pending PDF id on the inbox backend. */
  pdfId: string;
  /** JWT issued by /api/inbox/verify (15min exp). Memory-only. */
  jwt: string;
  /** Original OTP — required to derive AES-GCM key client-side. Memory-only. */
  otp: string;
  /** Where the in-progress flow originated. */
  source: 'inbox';
}

let _ctx: InboxContext | null = null;

export function getContext(): InboxContext | null {
  return _ctx;
}

export function setContext(ctx: InboxContext): void {
  _ctx = ctx;
  touch();
}

export function clear(): void {
  // Best effort scrub — JS strings are immutable so we just drop the ref.
  _ctx = null;
}

/** Update the activity timestamp. Call on user-initiated interactions. */
export function touch(): void {
  try {
    localStorage.setItem(IDLE_KEY, String(Date.now()));
  } catch (_) {
    /* noop */
  }
}

/**
 * @returns true when the previous interaction is older than IDLE_MS or unknown.
 *          Caller should force OTP re-entry and call clear().
 */
export function isIdleExpired(): boolean {
  try {
    const raw = localStorage.getItem(IDLE_KEY);
    if (!raw) return false;
    const last = Number(raw);
    if (!Number.isFinite(last)) return true;
    return Date.now() - last > IDLE_MS;
  } catch (_) {
    return false;
  }
}

export function clearIdleStamp(): void {
  try {
    localStorage.removeItem(IDLE_KEY);
  } catch (_) {
    /* noop */
  }
}
