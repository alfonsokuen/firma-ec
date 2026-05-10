/**
 * inboxApi.ts — typed fetch helpers for the firma-ec inbox backend (F3.5).
 *
 * All endpoints live under the configured base URL. We keep them as plain
 * functions so vitest tests can mock `fetch` without rendering Svelte
 * components.
 *
 * Memoria storefront-product-cache: we do NOT add `Authorization` to GETs
 * that the browser/CDN could cache. The backend already sends
 * `Cache-Control: no-store`, but to belt-and-suspenders we always pass
 * `cache: 'no-store'` from the client.
 */

export interface InboxItemRaw {
  id: string;
  sizeBytes: number;
  createdAt: string;
  saltB64: string;
  /** Only returned by /verify (and meta). /list does not include it. */
  senderPhoneMasked?: string;
}

export interface VerifyResponse {
  jwt: string;
  items: InboxItemRaw[];
}

export interface MetaResponse {
  id: string;
  sizeBytes: number;
  saltB64: string;
  senderPhoneMasked: string;
}

export interface BlobResponse {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

export interface OutboxOriginalTarget {
  kind: 'original';
}
export interface OutboxPhoneTarget {
  kind: 'phone';
  phone: string;
}
export type OutboxTarget = OutboxOriginalTarget | OutboxPhoneTarget;

export interface OutboxSendBody {
  id: string;
  signedPdfB64: string;
  target: OutboxTarget;
  caption?: string;
}

export class InboxApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'InboxApiError';
  }
}

/**
 * Resolve the inbox API base URL.
 *  - Production: https://inbox.firmar.ec (same Cloudflare Tunnel zone as app).
 *  - Dev:        Vite proxy or VITE_INBOX_API_BASE override.
 */
export function getInboxBase(): string {
  // import.meta.env is replaced at build time
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const override = env?.['VITE_INBOX_API_BASE'];
  if (override && override.length > 0) return override.replace(/\/+$/, '');
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'app.firmar.ec' || host === 'firmar.ec' || host === 'www.firmar.ec') {
      return 'https://inbox.firmar.ec';
    }
  }
  return 'https://inbox.firmar.ec';
}

async function asInboxError(res: Response): Promise<never> {
  let code = 'http_error';
  let message = `HTTP ${res.status}`;
  try {
    const data = (await res.json()) as { code?: string; message?: string };
    if (data.code) code = data.code;
    if (data.message) message = data.message;
  } catch (_) {
    /* fall through */
  }
  throw new InboxApiError(res.status, code, message);
}

function buildInit(base: RequestInit, signal: AbortSignal | undefined): RequestInit {
  // exactOptionalPropertyTypes requires we omit `signal` entirely when undefined.
  if (signal === undefined) return base;
  return { ...base, signal };
}

export async function verifyOtp(otp: string, signal?: AbortSignal): Promise<VerifyResponse> {
  const res = await fetch(
    `${getInboxBase()}/api/inbox/verify`,
    buildInit(
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ otp }),
        cache: 'no-store',
      },
      signal,
    ),
  );
  if (!res.ok) await asInboxError(res);
  return (await res.json()) as VerifyResponse;
}

export async function fetchMeta(
  id: string,
  jwt: string,
  signal?: AbortSignal,
): Promise<MetaResponse> {
  const res = await fetch(
    `${getInboxBase()}/api/inbox/${encodeURIComponent(id)}/meta`,
    buildInit(
      {
        method: 'GET',
        headers: { authorization: `Bearer ${jwt}` },
        cache: 'no-store',
      },
      signal,
    ),
  );
  if (!res.ok) await asInboxError(res);
  return (await res.json()) as MetaResponse;
}

export async function fetchBlob(
  id: string,
  jwt: string,
  signal?: AbortSignal,
): Promise<BlobResponse> {
  const res = await fetch(
    `${getInboxBase()}/api/inbox/${encodeURIComponent(id)}/blob`,
    buildInit(
      {
        method: 'GET',
        headers: { authorization: `Bearer ${jwt}` },
        cache: 'no-store',
      },
      signal,
    ),
  );
  if (!res.ok) await asInboxError(res);
  const ivHex = res.headers.get('x-iv-hex');
  if (!ivHex) {
    throw new InboxApiError(500, 'missing_iv', 'response missing x-iv-hex header');
  }
  const iv = hexToBytes(ivHex);
  if (iv.byteLength !== 12) {
    throw new InboxApiError(500, 'bad_iv', `iv must be 12 bytes, got ${iv.byteLength}`);
  }
  const ab = await res.arrayBuffer();
  const ciphertext = new Uint8Array(ab);
  return { iv, ciphertext };
}

export async function outboxSend(
  body: OutboxSendBody,
  jwt: string,
  signal?: AbortSignal,
): Promise<{ ok: true; evolutionMessageId: string }> {
  const res = await fetch(
    `${getInboxBase()}/api/outbox/send`,
    buildInit(
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      },
      signal,
    ),
  );
  if (!res.ok) await asInboxError(res);
  return (await res.json()) as { ok: true; evolutionMessageId: string };
}

// ── Helpers ──────────────────────────────────────────────────────────────

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0) {
    throw new Error('hex string must have even length');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(clean.substr(i * 2, 2), 16);
    if (!Number.isFinite(byte)) throw new Error(`bad hex at ${i}`);
    out[i] = byte;
  }
  return out;
}

/**
 * Validate Ecuador E.164 phone (mobile or fixed).
 * - +593 + [2-9] + 8 digits  ⇒ matches +5939XXXXXXXX (mobile) and +593[2-7]XXXXXXXX (landline).
 * Mirrors the server-side normalizePhoneEC regex shape.
 */
export function isValidEcuadorPhone(s: string): boolean {
  return /^\+593[2-9][0-9]{8}$/.test(s.trim());
}

/** Format bytes as KB or MB for the inbox list cards. */
export function formatSize(bytes: number): { value: string; unit: 'KB' | 'MB' } {
  if (bytes >= 1024 * 1024) {
    return { value: (bytes / (1024 * 1024)).toFixed(1), unit: 'MB' };
  }
  return { value: String(Math.max(1, Math.round(bytes / 1024))), unit: 'KB' };
}

export type RelativeTimeBucket = 'just_now' | 'minutes_ago' | 'hours_ago';

/** Returns the appropriate i18n bucket + value for a createdAt ISO string. */
export function relativeTime(
  iso: string,
  now: number = Date.now(),
): { bucket: RelativeTimeBucket; value: number } {
  const t = Date.parse(iso);
  const deltaMs = Number.isFinite(t) ? now - t : 0;
  const minutes = Math.max(0, Math.floor(deltaMs / 60_000));
  if (minutes < 1) return { bucket: 'just_now', value: 0 };
  if (minutes < 60) return { bucket: 'minutes_ago', value: minutes };
  return { bucket: 'hours_ago', value: Math.floor(minutes / 60) };
}
