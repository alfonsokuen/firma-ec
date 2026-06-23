import { beforeEach, describe, expect, test } from 'vitest';
import worker from '../src/main';

/**
 * worker.test.ts — handler behaviour over an in-memory KV.
 *
 * Covers the contract the landing relies on: validation (422), the unchanged
 * totals endpoint, the per-IP rate cap, and that a beacon of each type lands in
 * every per-period bucket so the series endpoint can chart it. Bucket sums (not
 * "today") are asserted to avoid a midnight-boundary flake.
 */

const RATE_MAX = 20; // mirrors main.ts

function kvMock() {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  const STATS = {
    get: async (k: string) => (store.has(k) ? store.get(k)! : null),
    put: async (k: string, v: string, opts?: { expirationTtl?: number }) => {
      store.set(k, v);
      if (opts?.expirationTtl != null) ttls.set(k, opts.expirationTtl);
    },
    delete: async (k: string) => {
      store.delete(k);
    },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
  return { env: { STATS }, ttls, store };
}

const ORIGIN = 'https://app.firmar.ec';
const IP = '203.0.113.7';

function post(type: string, env: { STATS: KVNamespace }, ip = IP): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}/api/stats/event?type=${type}`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'cf-connecting-ip': ip },
    }),
    env,
  );
}

function get(path: string, env: { STATS: KVNamespace }): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`, { headers: { origin: ORIGIN } }), env);
}

let mock: ReturnType<typeof kvMock>;
let env: { STATS: KVNamespace };
beforeEach(() => {
  mock = kvMock();
  env = mock.env;
});

describe('validation', () => {
  test('POST event with bad type → 422', async () => {
    expect((await post('bogus', env)).status).toBe(422);
  });
  test('GET series with bad granularity → 422', async () => {
    expect((await get('/api/stats/series?granularity=decade', env)).status).toBe(422);
  });
  test('GET series with no granularity → 422', async () => {
    expect((await get('/api/stats/series', env)).status).toBe(422);
  });
});

describe('totals endpoint stays intact', () => {
  test('reports the running sign total', async () => {
    await post('sign', env);
    await post('sign', env);
    const res = await get('/api/stats', env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pdfsSigned: number };
    expect(body.pdfsSigned).toBe(2);
  });
});

describe('beacon feeds the series (all three types)', () => {
  test('each event lands in every granularity and the totals', async () => {
    await post('sign', env);
    await post('sign', env);
    await post('verify', env);
    await post('cert', env);

    for (const granularity of ['minute', 'hour', 'day', 'week', 'month', 'year']) {
      const res = await get(`/api/stats/series?granularity=${granularity}`, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        granularity: string;
        since: string | null;
        buckets: { period: string; sign: number; verify: number; cert: number }[];
        totals: { sign: number; verify: number; cert: number };
      };
      expect(body.granularity).toBe(granularity);
      expect(body.since).not.toBeNull();
      const sum = (k: 'sign' | 'verify' | 'cert') => body.buckets.reduce((a, b) => a + b[k], 0);
      expect(sum('sign')).toBe(2);
      expect(sum('verify')).toBe(1);
      expect(sum('cert')).toBe(1);
      expect(body.totals).toEqual({ sign: 2, verify: 1, cert: 1 });
    }
  });

  test('cache-control: fresher for minute/hour, longer for trends', async () => {
    expect(
      (await get('/api/stats/series?granularity=minute', env)).headers.get('cache-control'),
    ).toContain('max-age=30');
    expect(
      (await get('/api/stats/series?granularity=hour', env)).headers.get('cache-control'),
    ).toContain('max-age=60');
    expect(
      (await get('/api/stats/series?granularity=day', env)).headers.get('cache-control'),
    ).toContain('max-age=300');
  });
});

describe('high-cardinality buckets self-expire', () => {
  test('minute & hour buckets get a TTL; day/week/month/year are permanent', async () => {
    await post('sign', env);
    const ttlKeys = [...mock.ttls.keys()];
    expect(ttlKeys.some((k) => k.startsWith('b:i:'))).toBe(true); // minute → TTL
    expect(ttlKeys.some((k) => k.startsWith('b:h:'))).toBe(true); // hour → TTL
    expect(ttlKeys.some((k) => k.startsWith('b:d:'))).toBe(false); // day permanent
    expect(ttlKeys.some((k) => k.startsWith('b:w:'))).toBe(false);
    expect(ttlKeys.some((k) => k.startsWith('b:m:'))).toBe(false);
    expect(ttlKeys.some((k) => k.startsWith('b:y:'))).toBe(false);
  });
});

describe('per-IP rate cap (anti-inflation, must stay behaviour-identical)', () => {
  test('drops events past RATE_MAX, still returns 204, and TTLs the limiter key', async () => {
    for (let i = 0; i < RATE_MAX + 1; i++) {
      const res = await post('sign', env);
      expect(res.status).toBe(204); // over-limit is accept-and-ignore, not an error
    }
    // Only RATE_MAX were counted; the (RATE_MAX+1)-th was dropped.
    const totals = (await (await get('/api/stats', env)).json()) as { pdfsSigned: number };
    expect(totals.pdfsSigned).toBe(RATE_MAX);
    const series = (await (await get('/api/stats/series?granularity=day', env)).json()) as {
      buckets: { sign: number }[];
    };
    expect(series.buckets.reduce((a, b) => a + b.sign, 0)).toBe(RATE_MAX);
    // The limiter key is short-lived, not a permanent counter.
    expect(mock.ttls.get(`rl:${IP}`)).toBe(3600);
  });

  test('a different IP is capped independently', async () => {
    for (let i = 0; i < RATE_MAX + 5; i++) await post('sign', env, '198.51.100.9');
    await post('verify', env, '203.0.113.250');
    const totals = (await (await get('/api/stats', env)).json()) as {
      pdfsSigned: number;
      signaturesVerified: number;
    };
    expect(totals.pdfsSigned).toBe(RATE_MAX); // first IP capped
    expect(totals.signaturesVerified).toBe(1); // second IP unaffected
  });
});
