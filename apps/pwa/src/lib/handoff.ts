/**
 * handoff.ts — OPT-IN cross-window "handoff" mode (postMessage contract v1).
 *
 * Purpose
 * -------
 * Let a trusted opener window (e.g. an internal intake app) hand a PDF to this
 * public firmar.ec PWA, have the user sign it ON-DEVICE with their own .p12,
 * and return the signed bytes to the opener — WITHOUT the document ever
 * touching the network from this PWA. The act enters via postMessage and the
 * signed result leaves via postMessage. No fetch / XHR / sendBeacon / WS /
 * form-submit carries the document.
 *
 * Gating
 * ------
 * Everything here is inert unless the page is loaded with `?handoff=1` in the
 * hash route query (this is a hash router: `/#/firmar?handoff=1`). Without it,
 * `isHandoffActive()` is false and the public flow behaves identically.
 *
 * Security
 * --------
 * - Inbound messages are accepted ONLY from an origin in the allow-list
 *   (VITE_HANDOFF_ALLOWLIST, comma-separated) AND only when
 *   `event.source === window.opener` (the window that opened us).
 * - The allow-list is FAIL-CLOSED: if VITE_HANDOFF_ALLOWLIST is unset/empty,
 *   `allowedOrigins()` returns [] and handoff is DISABLED — no opener is ever
 *   trusted until the deployer explicitly configures the env.
 * - Outbound messages target the validated opener origin explicitly (never '*').
 * - All payloads are shape-validated; anything malformed is ignored.
 *
 * Generic
 * -------
 * This module is product-neutral: no tenant / product specifics. The opener
 * identity is configured SOLELY at build/deploy time via VITE_HANDOFF_ALLOWLIST;
 * there is no hardcoded tenant default — an unconfigured deploy accepts nobody.
 */

// ── Contract types (version 1) ───────────────────────────────────────────
export const HANDOFF_PROTOCOL_VERSION = 1 as const;

/** Sent by the PWA when it mounts in handoff mode and is ready to receive. */
export interface ReadyMessage {
  type: 'firmarec:ready';
  version: typeof HANDOFF_PROTOCOL_VERSION;
}

/** Sent by the opener to deliver the document to sign. */
export interface LoadMessage {
  type: 'firmarec:load';
  version: typeof HANDOFF_PROTOCOL_VERSION;
  filename: string;
  pdfBase64: string;
}

/** Sent by the PWA (on explicit user consent) with the signed document. */
export interface SignedMessage {
  type: 'firmarec:signed';
  version: typeof HANDOFF_PROTOCOL_VERSION;
  filename: string;
  pdfBase64: string;
}

/** Sent by the PWA when the user cancels or the window is closing. */
export interface CancelMessage {
  type: 'firmarec:cancel';
  version: typeof HANDOFF_PROTOCOL_VERSION;
}

/** Sent by the PWA on a fatal error during the handoff. */
export interface ErrorMessage {
  type: 'firmarec:error';
  version: typeof HANDOFF_PROTOCOL_VERSION;
  message: string;
}

export type OutboundMessage = ReadyMessage | SignedMessage | CancelMessage | ErrorMessage;

// ── Gating ───────────────────────────────────────────────────────────────

/**
 * Read the query string that lives inside the hash route, e.g. the `handoff=1`
 * in `https://app.firmar.ec/#/firmar?handoff=1`. The svelte-spa-router keeps
 * route params in the hash, so `window.location.search` is usually empty here.
 */
function hashQueryParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  const hash = window.location.hash ?? '';
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return new URLSearchParams();
  return new URLSearchParams(hash.slice(qIndex + 1));
}

/** True iff the page was opened in opt-in handoff mode (`?handoff=1`). */
export function isHandoffActive(): boolean {
  if (typeof window === 'undefined') return false;
  // Accept it from either the hash query (hash router) or the plain query,
  // so a direct `?handoff=1` link also works before the router rewrites it.
  if (hashQueryParams().get('handoff') === '1') return true;
  try {
    return new URLSearchParams(window.location.search).get('handoff') === '1';
  } catch {
    return false;
  }
}

// ── Origin allow-list ─────────────────────────────────────────────────────

/**
 * Parse VITE_HANDOFF_ALLOWLIST (comma-separated origins) into a normalized
 * set. FAIL-CLOSED: if the env is unset/empty (or contains only malformed
 * entries), this returns [] and handoff is disabled — there is NO tenant
 * default baked into the public bundle. The opener is configured solely by
 * the deployer via VITE_HANDOFF_ALLOWLIST. Each entry is normalized through
 * the URL parser so trailing slashes / casing don't break the exact
 * `event.origin` comparison.
 */
export function allowedOrigins(): readonly string[] {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const raw = env?.['VITE_HANDOFF_ALLOWLIST'];
  if (!raw || raw.trim().length === 0) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      // `new URL(...).origin` yields the canonical scheme://host[:port].
      out.push(new URL(trimmed).origin);
    } catch {
      // Ignore malformed entries (fail-closed: a bad entry never widens trust).
    }
  }
  return out;
}

/** True iff `origin` exactly matches an allow-listed opener origin. */
export function isOriginAllowed(origin: string): boolean {
  return allowedOrigins().includes(origin);
}

// ── base64 <-> bytes (no network; mirrors sharedFile.ts) ──────────────────

/** Decode a base64 string into bytes. Throws on malformed input. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode bytes into base64. Chunked to avoid call-stack overflow on big PDFs. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

// ── Inbound validation ────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Narrow an unknown MessageEvent payload to a valid v1 LoadMessage. */
export function parseLoadMessage(data: unknown): LoadMessage | null {
  if (!isObject(data)) return null;
  // Bracket access: `data` is indexed (Record<string, unknown>), and the
  // tsconfig enables noPropertyAccessFromIndexSignature.
  const filename = data['filename'];
  const pdfBase64 = data['pdfBase64'];
  if (data['type'] !== 'firmarec:load') return null;
  if (data['version'] !== HANDOFF_PROTOCOL_VERSION) return null;
  if (typeof filename !== 'string' || filename.length === 0) return null;
  if (typeof pdfBase64 !== 'string' || pdfBase64.length === 0) return null;
  return {
    type: 'firmarec:load',
    version: HANDOFF_PROTOCOL_VERSION,
    filename,
    pdfBase64,
  };
}

// ── Session (module-scoped; survives lazy chunk boundaries, dies on reload) ─

interface HandoffSession {
  /** Validated origin of the opener (used as targetOrigin for outbound). */
  openerOrigin: string;
  /** The window that opened us (validated as event.source). */
  opener: Window;
}

let _session: HandoffSession | null = null;

/** The current handoff session, if a trusted opener has been validated. */
export function getHandoffSession(): HandoffSession | null {
  return _session;
}

/**
 * Post an outbound message to the validated opener, targeting its exact origin.
 * No-op if there is no validated session (fail-closed).
 */
function postToOpener(msg: OutboundMessage): void {
  const s = _session;
  if (!s) return;
  try {
    s.opener.postMessage(msg, s.openerOrigin);
  } catch {
    /* opener gone / closed — nothing to do */
  }
}

/** Emit `firmarec:ready` to the opener. */
export function sendReady(): void {
  postToOpener({ type: 'firmarec:ready', version: HANDOFF_PROTOCOL_VERSION });
}

/** Emit `firmarec:signed` (explicit user consent) with the signed PDF. */
export function sendSigned(filename: string, signedBytes: Uint8Array): void {
  postToOpener({
    type: 'firmarec:signed',
    version: HANDOFF_PROTOCOL_VERSION,
    filename,
    pdfBase64: bytesToBase64(signedBytes),
  });
}

/** Emit `firmarec:cancel`. */
export function sendCancel(): void {
  postToOpener({ type: 'firmarec:cancel', version: HANDOFF_PROTOCOL_VERSION });
}

/** Emit `firmarec:error` with a non-sensitive message. */
export function sendError(message: string): void {
  postToOpener({ type: 'firmarec:error', version: HANDOFF_PROTOCOL_VERSION, message });
}

/**
 * Install the postMessage listener for handoff mode and send the initial
 * `firmarec:ready` to the opener.
 *
 * @param onLoad Called once with the delivered PDF (filename + bytes) when a
 *               valid `firmarec:load` arrives from the trusted opener.
 * @returns A teardown function that removes the listener and clears the
 *          session. Safe to call multiple times.
 */
export function initHandoff(onLoad: (filename: string, bytes: Uint8Array) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const opener = window.opener as Window | null;
  if (!opener) {
    // Opened without an opener — handoff cannot complete. Stay inert.
    return () => {};
  }

  const handler = (event: MessageEvent): void => {
    // SECURITY: validate origin AND source before trusting anything.
    if (!isOriginAllowed(event.origin)) return;
    if (event.source !== opener) return;

    const load = parseLoadMessage(event.data);
    if (!load) return; // ignore unknown/malformed messages silently

    // First valid contact establishes the trusted session.
    _session = { openerOrigin: event.origin, opener };

    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(load.pdfBase64);
    } catch (e) {
      sendError('decode_failed: ' + (e instanceof Error ? e.message.slice(0, 80) : 'unknown'));
      return;
    }
    onLoad(load.filename, bytes);
  };

  window.addEventListener('message', handler);

  // Bootstrap the handshake: we don't yet know which allow-listed origin the
  // opener uses (event.origin tells us on the reply), so the ready ping must
  // target each allow-listed origin explicitly — never '*'.
  for (const origin of allowedOrigins()) {
    try {
      opener.postMessage({ type: 'firmarec:ready', version: HANDOFF_PROTOCOL_VERSION }, origin);
    } catch {
      /* a closed/cross-process opener may throw — ignore and continue */
    }
  }

  let torn = false;
  return () => {
    if (torn) return;
    torn = true;
    window.removeEventListener('message', handler);
    _session = null;
  };
}
