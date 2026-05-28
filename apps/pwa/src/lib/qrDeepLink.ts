/**
 * qrDeepLink.ts — F6.1 helpers for the `?h=<hex>` QR deep-link.
 *
 * The signer (packages/signer/src/pades.ts) embeds a QR encoding the URL
 * `https://app.firmar.ec/#/verificar?h=<sha256-12hex-of-unsigned-pdf>`. When a
 * user scans the QR, /verificar receives the hint as `?h=` and shows a
 * contextual banner inviting them to upload the signed PDF.
 *
 * These helpers only PARSE the hint (to detect "arrived via QR"); they do not
 * compare it. The QR encodes the hash of the *unsigned* source PDF, so it would
 * never match the signed PDF the user actually holds — surfacing that mismatch
 * read as a failure, so the compare was removed in 0.9.7. Verification is the
 * cryptographic verdict from the verifier worker, which needs the actual bytes
 * (aligned with the national standard: a QR alone verifies nothing).
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
