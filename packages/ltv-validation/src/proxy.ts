/**
 * F7.5 — Same-origin proxy map for OCSP / CRL upstreams.
 * F1   — extended to cover AIA `caIssuers` upstreams (missing-intermediate
 *        fallback, see `aia-certs.ts`).
 *
 * Why: ARCOTEL ACE responders rarely ship CORS headers, so direct fetch from
 * a browser PWA fails preflight. They also leak the user's IP to the upstream
 * CA (LOPDP / privacy concern). A same-origin reverse-proxy (Caddy `/api/ocsp/*`,
 * `/api/crl/*`, `/api/aia/*`) fixes both: CORS becomes a non-issue and the
 * upstream sees only the firmar.ec edge IP.
 *
 * Allowlist-only design: an open `?url=<encoded>` rewrite would be an SSRF
 * vector. Every entry here MUST match an explicit reverse_proxy route in
 * infra/docker/Caddyfile.pwa — keep the two in sync.
 *
 * Coverage today (2/17 ARCOTEL ACEs — both confirmed reachable 2026-05-10):
 *   - SECURITY DATA SubCA-2  OCSP + CRL
 *   - ArgosData CA 1         OCSP + CRL
 * Remaining 15 ACEs ship as they publish AIA URLs.
 *
 * AIA caIssuers coverage (F1, 2026-08-05):
 *   - UANATACA CA1 2016 (subordinate1.crt) — URL extracted via
 *     `extractCaIssuersUrls` from a REAL UANATACA leaf fixture
 *     (packages/verifier/tests/fixtures/leaf-uanataca.der).
 *   - UANATACA CA2 2016 (subordinate2.crt) — added same day, independently
 *     verified via OpenSSL (`openssl verify -partial_chain -trusted
 *     subordinate2.crt leaf-uanataca.der` succeeds; the same check against
 *     subordinate1.crt fails with "unable to get local issuer certificate").
 *     UANATACA quirk: the leaf fixture's OWN AIA extension points at
 *     subordinate1.crt (CA1) even though CA2 is its real issuer — the two
 *     URLs are kept as separate allowlist entries (not one alias) so
 *     `fetchIssuerCertViaAia`'s verification step decides which candidate
 *     actually signed the child, exactly as it would for any other ACE.
 *     This is a data quirk on UANATACA's side, not a code bug — F0's static
 *     bundle already covers UANATACA regardless, so it's non-blocking.
 */

export type ProxyMap = ReadonlyMap<string, string>;

/**
 * Built-in allowlist of known ARCOTEL ACE responder upstreams → same-origin paths.
 *
 * Keys: upstream URL as it appears in cert AIA / CDP. Matching is exact prefix
 * — anything not in the map is returned unchanged (caller decides whether to
 * fall back to a direct fetch).
 */
export const ARCOTEL_PROXY_MAP: ProxyMap = new Map<string, string>([
  // SECURITY DATA SubCA-2
  ['http://ocspgw.securitydata.net.ec/ejbca/publicweb/status/ocsp', '/api/ocsp/securitydata'],
  ['http://crl1.securitydata.net.ec/subca2crl1/crlfile.crl', '/api/crl/securitydata'],
  // ArgosData CA 1
  ['http://ocsp.argosdata.com.ec', '/api/ocsp/argosdata'],
  ['http://ocsp.argosdata.com.ec/', '/api/ocsp/argosdata'],
  [
    'http://crl.argosdata.com.ec/crl/0cdaea45-3374-42ca-9248-7d4797ea00a4.crl',
    '/api/crl/argosdata',
  ],
  // F1 — UANATACA AIA caIssuers (missing-intermediate fallback)
  [
    'http://www.uanataca.com/public/download/tsp_certificates/subordinate1.crt',
    '/api/aia/uanataca',
  ],
  // F1 HIGH-1b (2026-08-05) — UANATACA CA2 2016, the real issuer of the
  // leaf-uanataca.der test fixture (see module header for how this was
  // confirmed independently via OpenSSL).
  [
    'http://www.uanataca.com/public/download/tsp_certificates/subordinate2.crt',
    '/api/aia/uanataca-ca2',
  ],
]);

/**
 * Apply a proxy map to a single URL. If `url` matches an entry exactly,
 * returns the same-origin path; otherwise returns `url` unchanged.
 *
 * Relative-path return values are intended to be fetched same-origin by the
 * browser (e.g. `fetch('/api/ocsp/securitydata', …)`).
 */
export function applyProxyMap(url: string, map: ProxyMap = ARCOTEL_PROXY_MAP): string {
  const direct = map.get(url);
  if (direct !== undefined) return direct;
  // Also accept trailing-slash normalisation for OCSP responder URLs that
  // sometimes appear with and without it in AIA extensions.
  const trimmed = url.endsWith('/') ? url.slice(0, -1) : url + '/';
  return map.get(trimmed) ?? url;
}

/**
 * True iff `url` is covered by the proxy map. Useful for UI hints
 * ("este responder pasa por proxy same-origin") and CSP audit.
 */
export function isProxied(url: string, map: ProxyMap = ARCOTEL_PROXY_MAP): boolean {
  if (map.has(url)) return true;
  const trimmed = url.endsWith('/') ? url.slice(0, -1) : url + '/';
  return map.has(trimmed);
}
