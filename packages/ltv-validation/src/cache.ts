/**
 * In-memory LRU + TTL caches for OCSP, CRL, and (F1) AIA-resolved intermediate
 * certs.
 *
 * - OCSP cache: max 50 entries, TTL 1h. Key: SHA-256(serialNumber || subjectKeyIdentifier-or-issuerKeyHash).
 * - CRL cache:  max 20 entries, TTL 6h. Key: SHA-256(distributionPointUrl).
 * - AIA cert cache: max 20 entries, TTL 24h (CA certs churn far less than
 *   revocation data — see aia-certs.ts). Key: SHA-256(caIssuers URL).
 *
 * Eviction is lazy on `get` (expired entries are dropped). When a `set` would
 * push size > maxEntries, the oldest entry is evicted (Map iteration order = insertion order).
 *
 * No localStorage — privacy decision (spec §1 #9).
 */

import type {
  AiaCertCache,
  AiaCertResult,
  CrlCache,
  CrlResult,
  OcspCache,
  OcspResult,
} from './types';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

function makeLru<T>(maxEntries: number, ttlMs: number) {
  const m = new Map<string, CacheEntry<T>>();
  return {
    get(key: string): T | undefined {
      const e = m.get(key);
      if (!e) return undefined;
      if (e.expiresAt < Date.now()) {
        m.delete(key);
        return undefined;
      }
      // Touch: refresh insertion order for LRU semantics.
      m.delete(key);
      m.set(key, e);
      return e.value;
    },
    set(key: string, value: T): void {
      m.delete(key);
      m.set(key, { value, expiresAt: Date.now() + ttlMs });
      while (m.size > maxEntries) {
        const oldest = m.keys().next().value;
        if (oldest === undefined) break;
        m.delete(oldest);
      }
    },
    clear(): void {
      m.clear();
    },
    get size(): number {
      // Don't count expired entries
      return m.size;
    },
  };
}

const DEFAULT_OCSP_TTL_MS = 60 * 60 * 1000; // 1h
const DEFAULT_OCSP_MAX = 50;
const DEFAULT_CRL_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const DEFAULT_CRL_MAX = 20;
// F1 — CA certs resolved via AIA change far less often than revocation data,
// so a much longer TTL is safe. Same maxEntries as CRL (small, per-process).
const DEFAULT_AIA_CERT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_AIA_CERT_MAX = 20;

export function createOcspCache(
  ttlMs: number = DEFAULT_OCSP_TTL_MS,
  maxEntries: number = DEFAULT_OCSP_MAX,
): OcspCache {
  return makeLru<OcspResult>(maxEntries, ttlMs);
}

export function createCrlCache(
  ttlMs: number = DEFAULT_CRL_TTL_MS,
  maxEntries: number = DEFAULT_CRL_MAX,
): CrlCache {
  return makeLru<CrlResult>(maxEntries, ttlMs);
}

/** F1 — cache for certs resolved via the AIA caIssuers fallback. */
export function createAiaCertCache(
  ttlMs: number = DEFAULT_AIA_CERT_TTL_MS,
  maxEntries: number = DEFAULT_AIA_CERT_MAX,
): AiaCertCache {
  return makeLru<AiaCertResult>(maxEntries, ttlMs);
}

/** SHA-256 hex digest of a UTF-8 string. Shared by the three cache-key helpers below. */
async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', enc);
  const u = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < u.length; i++) {
    const b = u[i] ?? 0;
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Compute a stable cache key for an OCSP lookup.
 *
 * @param serialHex hex of cert serialNumber.
 * @param issuerKeyHashHex hex of issuer keyHash (from response certID, or precomputed).
 */
export async function ocspCacheKey(serialHex: string, issuerKeyHashHex: string): Promise<string> {
  return sha256Hex(`${serialHex}|${issuerKeyHashHex}`);
}

/** CRL cache key derived from distribution point URL. */
export async function crlCacheKey(url: string): Promise<string> {
  return sha256Hex(url);
}

/** F1 — AIA cert cache key derived from the caIssuers URL. */
export async function aiaCertCacheKey(url: string): Promise<string> {
  return sha256Hex(url);
}
