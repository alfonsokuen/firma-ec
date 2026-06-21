/**
 * handoff.ts — OPT-IN deep-link "handoff" mode (fetch contract v2).
 *
 * Purpose
 * -------
 * Let a trusted intake app hand a PDF to this public firmar.ec PWA via a plain
 * deep link, have the user sign it ON-DEVICE with their own .p12, and POST the
 * signed bytes back to the intake app's callback. Unlike the previous v1
 * (popup + postMessage), this works inside the in-app browser of WhatsApp,
 * where `window.opener` is lost and popups silently fail: the act is FETCHED
 * directly from a `src` URL and the signed result is POSTed to a `cb` URL.
 *
 * The .p12 key and the signature itself NEVER leave the device — only the
 * source act (already on the intake server) and the signed result travel, both
 * exclusively to allow-listed origins.
 *
 * Gating
 * ------
 * Everything here is inert unless the page is loaded with `?handoff=1` in the
 * hash route query (this is a hash router: `/#/firmar?handoff=1`). Without it,
 * `isHandoffActive()` is false and the public flow behaves identically.
 *
 * Security (anti-SSRF)
 * --------------------
 * - The PWA fetches/POSTs ONLY to origins in the allow-list
 *   (VITE_HANDOFF_ALLOWLIST, comma-separated). Both `src` and `cb` are checked
 *   with `isUrlAllowed()` BEFORE any network call; a non-allowed URL is
 *   rejected (never fetched). This is the anti-SSRF defense: an attacker who
 *   crafts a malicious deep link cannot make the PWA fetch/POST to an internal
 *   or arbitrary host.
 * - The allow-list is FAIL-CLOSED: if VITE_HANDOFF_ALLOWLIST is unset/empty,
 *   `allowedOrigins()` returns [] and handoff is DISABLED — no origin is ever
 *   trusted until the deployer explicitly configures the env.
 * - The callback POST is a SIMPLE request (no custom headers) so it never
 *   triggers a CORS preflight; the token rides inside the URL, not a header.
 *
 * Generic
 * -------
 * This module is product-neutral: no tenant / product specifics. The trusted
 * intake identity is configured SOLELY at build/deploy time via
 * VITE_HANDOFF_ALLOWLIST; there is no hardcoded tenant default — an
 * unconfigured deploy accepts nobody.
 */

// ── Limits ───────────────────────────────────────────────────────────────
/** Reject source PDFs larger than this (defensive; matches the signer cap). */
const MAX_SOURCE_PDF_BYTES = 30 * 1024 * 1024; // 30 MiB

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
 * default baked into the public bundle. The trusted intake is configured
 * solely by the deployer via VITE_HANDOFF_ALLOWLIST. Each entry is normalized
 * through the URL parser so trailing slashes / casing don't break the exact
 * origin comparison.
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

/**
 * True iff `url`'s origin exactly matches an allow-listed origin. Anti-SSRF
 * gate for BOTH the source fetch and the callback POST: a malformed URL or any
 * origin outside the allow-list is rejected. Fail-closed (empty list → false).
 */
export function isUrlAllowed(url: string): boolean {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false; // unparseable URL is never trusted
  }
  return allowedOrigins().includes(origin);
}

// ── Deep-link params ───────────────────────────────────────────────────────

export interface HandoffParams {
  /** Absolute URL to GET the source PDF from (token is inside the URL). */
  src: string | null;
  /** Absolute URL to POST the signed PDF to (token is inside the URL). */
  cb: string | null;
}

/**
 * Read `src` and `cb` from the hash-query of the deep link. Both are absolute
 * URLs and arrive percent-encoded, so they're decoded here. Returns null for a
 * missing param. NOTE: presence ≠ trust — every value MUST still pass
 * `isUrlAllowed()` before it is fetched/POSTed.
 */
export function parseHandoffParams(): HandoffParams {
  const q = hashQueryParams();
  const decode = (key: string): string | null => {
    const raw = q.get(key);
    if (raw === null || raw.length === 0) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return null; // malformed percent-encoding → treat as absent (fail-closed)
    }
  };
  return { src: decode('src'), cb: decode('cb') };
}

// ── Source fetch (anti-SSRF gated) ─────────────────────────────────────────

/**
 * Fetch the source act from `src` and return it as a `File` ready for the
 * normal sign pipeline. Throws if `src` is not allow-listed (anti-SSRF), if
 * the HTTP request fails, or if the payload doesn't look like a PDF.
 *
 * The token authorizing the read rides inside the URL, so the request carries
 * NO credentials (`credentials: 'omit'`) and NO custom headers.
 */
export async function fetchSourcePdf(src: string): Promise<File> {
  if (!isUrlAllowed(src)) {
    throw new Error('handoff_src_not_allowed');
  }

  let res: Response;
  try {
    res = await fetch(src, { method: 'GET', credentials: 'omit', cache: 'no-store' });
  } catch (e) {
    throw new Error('handoff_src_fetch_failed: ' + errSnippet(e));
  }
  if (!res.ok) {
    throw new Error('handoff_src_http_' + res.status);
  }

  // Content-type is a soft signal (some servers send octet-stream); the magic
  // bytes below are the authoritative check.
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  if (contentType && !contentType.includes('pdf') && !contentType.includes('octet-stream')) {
    throw new Error('handoff_src_not_pdf_content_type');
  }

  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.byteLength === 0) {
    throw new Error('handoff_src_empty');
  }
  if (bytes.byteLength > MAX_SOURCE_PDF_BYTES) {
    throw new Error('handoff_src_too_large');
  }
  // Magic: a real PDF begins with "%PDF" (optionally after a small BOM/gap, but
  // the spec requires it at byte 0; we accept a tiny leading offset defensively).
  if (!hasPdfMagic(bytes)) {
    throw new Error('handoff_src_not_pdf_magic');
  }

  // Derive a filename from the URL path; fall back to a generic name.
  const filename = filenameFromUrl(src);
  return new File([buf], filename, { type: 'application/pdf' });
}

// ── Signed callback POST (anti-SSRF gated, simple request) ─────────────────

export interface CallbackResult {
  /** True iff the callback accepted and persisted the signed document. */
  ok: boolean;
  /** True iff the callback also re-sent the signed document over WhatsApp. */
  wa_sent: boolean;
}

/**
 * POST the signed PDF to `cb` as multipart/form-data with the field `file`.
 * Throws if `cb` is not allow-listed (anti-SSRF) or the HTTP request fails /
 * returns a non-2xx status.
 *
 * SIMPLE REQUEST: FormData sets a browser-computed Content-Type and we add NO
 * custom headers, so the browser does NOT issue a CORS preflight. The token
 * authorizing the callback rides inside the URL.
 */
export async function postSignedToCallback(
  cb: string,
  filename: string,
  blob: Blob,
): Promise<CallbackResult> {
  if (!isUrlAllowed(cb)) {
    throw new Error('handoff_cb_not_allowed');
  }

  const form = new FormData();
  form.append('file', blob, filename);

  let res: Response;
  try {
    res = await fetch(cb, { method: 'POST', body: form, credentials: 'omit' });
  } catch (e) {
    throw new Error('handoff_cb_fetch_failed: ' + errSnippet(e));
  }
  if (!res.ok) {
    throw new Error('handoff_cb_http_' + res.status);
  }

  // Best-effort JSON parse; tolerate a callback that returns an empty/!json
  // body by treating it as a bare success with wa_sent unknown (=false).
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return {
    ok: readBool(body, 'ok', true),
    wa_sent: readBool(body, 'wa_sent', false),
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────

function errSnippet(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 80) : 'unknown';
}

/** A PDF must begin with the bytes "%PDF" (allow a tiny leading offset). */
function hasPdfMagic(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.byteLength - 4, 8);
  for (let i = 0; i <= limit; i++) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 // F
    ) {
      return true;
    }
  }
  return false;
}

function filenameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const last = path.split('/').filter(Boolean).pop() ?? '';
    const name = decodeURIComponent(last);
    if (name && /\.pdf$/i.test(name)) return name;
    if (name) return `${name}.pdf`;
  } catch {
    /* fall through to default */
  }
  return 'documento.pdf';
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Read a boolean field from an unknown JSON body, with a default fallback. */
function readBool(body: unknown, key: string, fallback: boolean): boolean {
  if (!isObject(body)) return fallback;
  const v = body[key];
  return typeof v === 'boolean' ? v : fallback;
}
