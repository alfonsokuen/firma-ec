/**
 * qrDeepLink.ts — F6.1 helpers for `?h=<hex>` QR deep-link verification.
 *
 * The signer (packages/signer/src/pades.ts) embeds a QR encoding the URL
 * `https://firmar.ec/#/verificar?h=<sha256-12hex-of-unsigned-pdf>`. When a
 * user scans the QR, /verificar receives the hash hint as `?h=`. These helpers
 * parse the hint and let Verificar.svelte compare it to the SHA-256 (12 hex)
 * of whatever PDF the user uploaded.
 *
 * The hash compare is purely informational — the cryptographic verification
 * is the source of truth. See README/CHANGELOG for the hash semantics caveat:
 * the QR encodes the hash of the *unsigned* source PDF, so uploading the
 * signed PDF will NOT match (and that's expected).
 */

/**
 * Extract a hex hash from a hash-router querystring like `t=abc&h=01ab23`.
 * Accepts either the raw query (no leading `?`) or the value with one.
 * Returns lowercased hex if `h` is present and matches `^[0-9a-f]{1,32}$`,
 * otherwise null. Malformed values are rejected silently — the verification
 * UX simply hides the QR banner.
 */
export function parseQrHash(querystring: string | null | undefined): string | null {
  if (!querystring) return null;
  const qs = querystring.startsWith('?') ? querystring.slice(1) : querystring;
  const sp = new URLSearchParams(qs);
  const raw = sp.get('h');
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return /^[0-9a-f]{1,32}$/.test(lower) ? lower : null;
}

/**
 * Read `h=` from `window.location.hash` (hash-router URL). Browser-only
 * convenience wrapper around `parseQrHash`. Returns null in non-browser envs.
 */
export function readQrHashFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash || '';
  const qIdx = hash.indexOf('?');
  if (qIdx < 0) return null;
  return parseQrHash(hash.substring(qIdx + 1));
}

/**
 * Compute SHA-256 of `pdfBytes`, take first 12 hex chars (matching the signer),
 * and compare against `expected` (already validated/normalized lowercase hex).
 * `expected` may be shorter than 12 — we compare the prefix of the computed
 * digest of the same length so legacy/short hints still work.
 */
export async function compareHash12(
  pdfBytes: ArrayBuffer | Uint8Array,
  expected: string,
): Promise<{ match: boolean; computed: string }> {
  const buf =
    pdfBytes instanceof Uint8Array
      ? (pdfBytes.buffer.slice(
          pdfBytes.byteOffset,
          pdfBytes.byteOffset + pdfBytes.byteLength,
        ) as ArrayBuffer)
      : pdfBytes;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const computed = hex.slice(0, 12);
  const expectedLen = Math.min(expected.length, 12);
  const match = computed.slice(0, expectedLen) === expected.slice(0, expectedLen);
  return { match, computed };
}
