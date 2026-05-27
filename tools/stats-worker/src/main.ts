/**
 * firmar.ec usage-stats worker.
 *
 * GET  /api/stats        → { pdfsSigned, signaturesVerified, certificatesIssued }
 * POST /api/stats/event?type=sign|verify  → 204 (anonymous beacon)
 *
 * Why an edge worker: the landing is a static site, so a live counter needs a
 * tiny endpoint. This one is fully isolated from the signing app — it stores
 * only two integers in KV (no PII, no document data), keeping firmar.ec's
 * zero-knowledge / LOPDP posture intact. Signing & verification happen entirely
 * client-side, so these are best-effort usage tallies, not attestable proofs;
 * a per-IP cap resists trivial inflation. KV is eventually consistent, which is
 * fine for social-proof counters.
 */

interface Env {
  STATS: KVNamespace;
}

const KEY = { sign: 'count:sign', verify: 'count:verify' } as const;
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const headers = cors(req.headers.get('origin'));

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === '/api/stats' && req.method === 'GET') {
      const [signed, verified] = await Promise.all([
        num(env.STATS, KEY.sign),
        num(env.STATS, KEY.verify),
      ]);
      return Response.json(
        { pdfsSigned: signed, signaturesVerified: verified, certificatesIssued: null },
        { headers: { ...headers, 'cache-control': 'public, max-age=60' } },
      );
    }

    if (url.pathname === '/api/stats/event' && req.method === 'POST') {
      const type = url.searchParams.get('type');
      if (type !== 'sign' && type !== 'verify') {
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

      const count = await num(env.STATS, KEY[type]);
      await env.STATS.put(KEY[type], String(count + 1));
      return new Response(null, { status: 204, headers });
    }

    return new Response('Not found', { status: 404, headers });
  },
};
