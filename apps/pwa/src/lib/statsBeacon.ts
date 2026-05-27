/**
 * statsBeacon.ts — fire-and-forget anonymous usage ping for the public landing
 * counters (documentos firmados / firmas verificadas).
 *
 * Privacy: there is no payload beyond the event type — no document, no hash, no
 * identifier. Signing/verification run entirely client-side (zero-knowledge),
 * so this is a best-effort usage tally, never a proof. It is also strictly
 * decorative: every failure is swallowed so telemetry can never break a sign or
 * verify flow.
 *
 * Transport: a body-less POST with the type in the query string keeps the
 * request CORS-preflight-free, which is what `navigator.sendBeacon` needs to
 * deliver reliably (including during page unload). The endpoint is the edge
 * Worker on the apex (firmar.ec), which allows the app.firmar.ec origin.
 */
export type UsageEvent = 'sign' | 'verify';

/** Edge Worker origin that serves /api/stats (same zone as the landing). */
const STATS_BASE = 'https://firmar.ec';

export function pingUsage(type: UsageEvent): void {
  if (typeof navigator === 'undefined') return;
  try {
    const url = `${STATS_BASE}/api/stats/event?type=${encodeURIComponent(type)}`;
    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url);
      return;
    }
    void fetch(url, { method: 'POST', keepalive: true, cache: 'no-store' }).catch(() => {});
  } catch {
    /* never let telemetry break the app */
  }
}
