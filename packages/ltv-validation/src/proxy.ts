/**
 * F7.5 — Same-origin proxy map for OCSP / CRL upstreams.
 *
 * Why: ARCOTEL ACE responders rarely ship CORS headers, so direct fetch from
 * a browser PWA fails preflight. They also leak the user's IP to the upstream
 * CA (LOPDP / privacy concern). A same-origin reverse-proxy (Caddy `/api/ocsp/*`
 * and `/api/crl/*`) fixes both: CORS becomes a non-issue and the upstream sees
 * only the firmar.ec edge IP.
 *
 * Allowlist-only design: an open `?url=<encoded>` rewrite would be an SSRF
 * vector. Every entry here MUST match an explicit reverse_proxy route in
 * infra/docker/Caddyfile.pwa — keep the two in sync.
 *
 * Coverage today (2/17 ARCOTEL ACEs — both confirmed reachable 2026-05-10):
 *   - SECURITY DATA SubCA-2  OCSP + CRL
 *   - ArgosData CA 1         OCSP + CRL
 * Remaining 15 ACEs ship as they publish AIA URLs.
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
