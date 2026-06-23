/**
 * firmar.ec usage-stats worker.
 *
 * GET  /api/stats         → { pdfsSigned, signaturesVerified, certificatesValidated, certificatesIssued }
 * GET  /api/stats/series?granularity=day|week|month|year
 *                         → { granularity, since, buckets:[{period,sign,verify,cert}], totals }
 * POST /api/stats/event?type=sign|verify|cert  → 204 (anonymous beacon)
 *
 * Why an edge worker: the landing is a static site, so a live counter needs a
 * tiny endpoint. This one is fully isolated from the signing app — it stores
 * only integer tallies in KV (no PII, no document data), keeping firmar.ec's
 * zero-knowledge / LOPDP posture intact. Beyond the running totals it keeps
 * per-period buckets (day/week/month/year, see series.ts) so the public stats
 * page can chart trends — still pure volume, no identifiers. Signing &
 * verification happen entirely client-side, so these are best-effort usage
 * tallies, not attestable proofs; a per-IP cap resists trivial inflation. KV is
 * eventually consistent, which is fine for social-proof counters.
 */

import {
  type EventType,
  type Granularity,
  bumpCount,
  combinedKey,
  dayStr,
  ecCivil,
  eventCombinedKeys,
  isGranularity,
  parseCounts,
  periodsFor,
  serializeCounts,
  ttlFor,
} from './series';

interface Env {
  STATS: KVNamespace;
}

const KEY = { sign: 'count:sign', verify: 'count:verify', cert: 'count:cert' } as const;
const SINCE_KEY = 'meta:since';
const ALLOWED_ORIGINS = new Set([
  'https://firmar.ec',
  'https://www.firmar.ec',
  'https://app.firmar.ec',
]);
const RATE_MAX = 20; // events per IP per hour
const RATE_TTL_S = 3600;

function cors(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://firmar.ec';
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'Origin',
  };
}

async function num(kv: KVNamespace, key: string): Promise<number> {
  const v = await kv.get(key);
  const n = v === null ? 0 : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Best-effort increment (KV has no atomic incr; same posture as the totals). */
async function inc(kv: KVNamespace, key: string): Promise<void> {
  const current = await num(kv, key);
  await kv.put(key, String(current + 1));
}

/**
 * Best-effort increment of one event type inside a combined per-period key.
 * `ttlS` (minute/hour buckets) lets those high-cardinality keys self-expire.
 */
async function incCombined(
  kv: KVNamespace,
  key: string,
  type: EventType,
  ttlS: number | null,
): Promise<void> {
  const counts = parseCounts(await kv.get(key));
  const value = serializeCounts(bumpCount(counts, type));
  await kv.put(key, value, ttlS ? { expirationTtl: ttlS } : {});
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const headers = cors(req.headers.get('origin'));

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === '/api/stats' && (req.method === 'GET' || req.method === 'HEAD')) {
      const [signed, verified, validated] = await Promise.all([
        num(env.STATS, KEY.sign),
        num(env.STATS, KEY.verify),
        num(env.STATS, KEY.cert),
      ]);
      return Response.json(
        {
          pdfsSigned: signed,
          signaturesVerified: verified,
          certificatesValidated: validated,
          certificatesIssued: null,
        },
        { headers: { ...headers, 'cache-control': 'public, max-age=60' } },
      );
    }

    if (url.pathname === '/api/stats/series' && (req.method === 'GET' || req.method === 'HEAD')) {
      const granularity = url.searchParams.get('granularity');
      if (!isGranularity(granularity)) {
        return Response.json({ error: 'invalid_input' }, { status: 422, headers });
      }

      const periods = periodsFor(granularity, Date.now());
      // One combined get per period (≤ WINDOW value) + the three totals + since.
      // Worst case (day=30) is 34 subrequests — safe on any Workers plan.
      const [rawCounts, signed, verified, validated, since] = await Promise.all([
        Promise.all(periods.map((period) => env.STATS.get(combinedKey(granularity, period)))),
        num(env.STATS, KEY.sign),
        num(env.STATS, KEY.verify),
        num(env.STATS, KEY.cert),
        env.STATS.get(SINCE_KEY),
      ]);
      const buckets = periods.map((period, i) => {
        const c = parseCounts(rawCounts[i]);
        return { period, sign: c.sign, verify: c.verify, cert: c.cert };
      });

      // Fresher edge cache for the live-ish granularities; trends can sit longer.
      const maxAge: Record<Granularity, number> = {
        minute: 30,
        hour: 60,
        day: 300,
        week: 300,
        month: 300,
        year: 300,
      };
      return Response.json(
        {
          granularity,
          since: since ?? null,
          buckets,
          totals: { sign: signed, verify: verified, cert: validated },
        },
        { headers: { ...headers, 'cache-control': `public, max-age=${maxAge[granularity]}` } },
      );
    }

    if (url.pathname === '/api/stats/event' && req.method === 'POST') {
      const type = url.searchParams.get('type');
      if (type !== 'sign' && type !== 'verify' && type !== 'cert') {
        return Response.json({ error: 'invalid_input' }, { status: 422, headers });
      }

      // Per-IP cap (best-effort; KV is eventually consistent).
      const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
      const rlKey = `rl:${ip}`;
      const used = await num(env.STATS, rlKey);
      if (used >= RATE_MAX) {
        // Accept-and-ignore: don't count, don't leak limiter state.
        return new Response(null, { status: 204, headers });
      }
      await env.STATS.put(rlKey, String(used + 1), { expirationTtl: RATE_TTL_S });

      // Running total (unchanged) + combined per-period buckets for the charts.
      const now = Date.now();
      const ev = type as EventType;
      await Promise.all([
        inc(env.STATS, KEY[ev]),
        ...eventCombinedKeys(now).map(({ g, key }) => incCombined(env.STATS, key, ev, ttlFor(g))),
      ]);
      // First-seen date for the "data since…" honesty note (set once, best-effort).
      const since = await env.STATS.get(SINCE_KEY);
      if (!since) await env.STATS.put(SINCE_KEY, dayStr(ecCivil(now)));

      return new Response(null, { status: 204, headers });
    }

    return new Response('Not found', { status: 404, headers });
  },
};
