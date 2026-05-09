/**
 * tsl.ts — Runtime TSL loader with SRI integrity check.
 *
 * Fetches /trust/tsl-ec.json and verifies it matches the SHA-256 hash
 * baked into the bundle at build time (via Vite `define`).
 *
 * The trust list is always fetched network-only (see vite.config.ts Workbox rule)
 * so stale Service Worker cache never serves a revoked TSL.
 *
 * Usage:
 *   import { loadTsl } from '$lib/tsl';
 *   const tsl = await loadTsl();
 */

import type { TrustRoot } from '@firma-ec/tsl-ec';

/** Injected by Vite at build time from apps/pwa/public/trust/tsl-ec.sha256 */
declare const __TSL_HASH__: string;

export interface TrustList {
  version: string;
  sequence: number;
  generatedAt: string;
  roots: TrustRoot[];
}

export class TslIntegrityError extends Error {
  constructor(expected: string, got: string) {
    super(`TSL integrity check failed.\n  Expected: ${expected}\n  Got:      ${got}`);
    this.name = 'TslIntegrityError';
  }
}

/**
 * Compute SHA-256 of a string using the Web Crypto API.
 * Returns lowercase hex string with no separators.
 */
async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Fetch and verify the trust list.
 *
 * @param url Override the default /trust/tsl-ec.json URL (useful in tests).
 * @throws {TslIntegrityError} if the fetched JSON does not match __TSL_HASH__.
 * @throws {TypeError} if the fetch fails (network error, non-ok status).
 */
export async function loadTsl(url = '/trust/tsl-ec.json'): Promise<TrustList> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new TypeError(`Failed to fetch TSL: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  const hash = await sha256Hex(text);
  const expected = __TSL_HASH__;

  if (hash !== expected) {
    throw new TslIntegrityError(expected, hash);
  }

  return JSON.parse(text) as TrustList;
}

/**
 * Return only non-placeholder roots from a trust list.
 * Logs a warning for each placeholder slot so developers notice during dev.
 */
export function effectiveRoots(tsl: TrustList): TrustRoot[] {
  const real: TrustRoot[] = [];
  for (const root of tsl.roots) {
    if (root.isPlaceholder) {
      console.warn(
        `[tsl] Placeholder root skipped: ${root.slug} — ${root.notes ?? 'replace before production'}`,
      );
    } else {
      real.push(root);
    }
  }
  return real;
}
