/**
 * sharedFile.ts — sessionStorage handoff for PDFs that arrive via the OS
 * (file_handlers launchQueue, share_target, future SW POST /share intercept).
 *
 * Constraints:
 * - Stays sessionStorage-only: privacy claim ("nothing leaves the browser") is
 *   preserved; no IndexedDB persistence across tabs/sessions.
 * - Encodes Uint8Array as base64 because sessionStorage is string-only.
 * - TTL is the lifetime of the tab — explicit `consume()` clears it on read so
 *   reload of /firmar or /verificar doesn't reuse a stale shared payload.
 *
 * Used by: SharedFileHandler.svelte (write), Verificar.svelte + Firmar.svelte
 * (consume on mount).
 */

const KEY = '__incomingPdf';
const KEY_NAME = '__incomingPdfName';

export interface IncomingPdf {
  bytes: Uint8Array;
  name: string;
}

function uint8ToBase64(bytes: Uint8Array): string {
  // Chunked to avoid call-stack overflow on large PDFs (apply spreads each byte).
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function stash(bytes: Uint8Array, name: string): void {
  try {
    sessionStorage.setItem(KEY, uint8ToBase64(bytes));
    sessionStorage.setItem(KEY_NAME, name);
  } catch (_) {
    // QuotaExceededError on huge PDFs — fail silently; user falls back to picker.
  }
}

export function consume(): IncomingPdf | null {
  let raw: string | null;
  let name: string | null;
  try {
    raw = sessionStorage.getItem(KEY);
    name = sessionStorage.getItem(KEY_NAME);
  } catch (_) {
    return null;
  }
  if (!raw) return null;
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY_NAME);
  } catch (_) {
    /* noop */
  }
  try {
    return { bytes: base64ToUint8(raw), name: name ?? 'shared.pdf' };
  } catch (_) {
    return null;
  }
}

export function hasPending(): boolean {
  try {
    return sessionStorage.getItem(KEY) !== null;
  } catch (_) {
    return false;
  }
}
