/**
 * API keys, quota, concurrency and idempotency (OWASP API1/API2/API4).
 *
 * These assert the security posture in BOTH directions: a valid key works, and
 * each specific way of being invalid is refused — indistinguishably, so the
 * endpoint never becomes an oracle that tells an attacker which half of the
 * token they got right.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, test } from 'vitest';
import { mintApiKey, parseApiKey, verifySecret } from '../src/lib/apiKey.js';
import { InMemoryIdempotencyStore } from '../src/services/idempotency.js';
import { InMemoryQuotaStore } from '../src/services/quota.js';
import { TEST_PEPPER, type TestKey, auth, buildTestServer, makeTestKey } from './helpers.js';

const FIX = resolve(__dirname, '../../../packages/verifier/tests/fixtures');
const signedPdf = (): Promise<Buffer> => readFile(resolve(FIX, 'eci-real-signed.pdf'));

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('key minting and verification', () => {
  test('a minted token round-trips, and the secret is never the stored hash', () => {
    const minted = mintApiKey(TEST_PEPPER);
    const parsed = parseApiKey(minted.token);
    expect(parsed).not.toBeNull();
    expect(parsed?.keyId).toBe(minted.keyId);
    expect(verifySecret(parsed!.secret, minted.secretHash, TEST_PEPPER)).toBe(true);
    // What we persist must not contain what the user holds.
    expect(minted.secretHash).not.toContain(parsed!.secret);
    expect(minted.token).not.toContain(minted.secretHash);
  });

  test('two mints never collide', () => {
    const ids = new Set(Array.from({ length: 200 }, () => mintApiKey(TEST_PEPPER).keyId));
    expect(ids.size).toBe(200);
  });

  test('a tampered token fails the checksum without any store lookup', () => {
    const minted = mintApiKey(TEST_PEPPER);
    const last = minted.token.slice(-1);
    const flipped = `${minted.token.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
    expect(parseApiKey(flipped)).toBeNull();
  });

  test('the wrong pepper never validates — a stolen DB alone is useless', () => {
    const minted = mintApiKey(TEST_PEPPER);
    const parsed = parseApiKey(minted.token);
    const otherPepper = 'a-different-pepper-'.padEnd(48, 'z');
    expect(verifySecret(parsed!.secret, minted.secretHash, otherPepper)).toBe(false);
  });

  test('a weak pepper is refused outright rather than used', () => {
    expect(() => mintApiKey('too-short')).toThrow(/pepper/i);
  });
});

describe('authentication (API2)', () => {
  const cases: [string, () => Record<string, string>][] = [
    ['no header', () => ({})],
    ['not bearer', () => ({ authorization: 'Basic abc' })],
    ['garbage token', () => ({ authorization: 'Bearer not-a-real-token' })],
    [
      'well-formed but unknown key',
      () => ({ authorization: `Bearer ${mintApiKey(TEST_PEPPER).token}` }),
    ],
  ];

  for (const [label, headers] of cases) {
    test(`rejects: ${label}`, async () => {
      const key = makeTestKey();
      app = await buildTestServer(key);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/verify',
        headers: { 'content-type': 'application/pdf', ...headers() },
        payload: await signedPdf(),
      });
      expect(res.statusCode).toBe(401);
      // Identical body for every failure mode: no oracle.
      expect(res.json()).toEqual({ error: 'unauthorized' });
      expect(res.headers['www-authenticate']).toContain('Bearer');
    });
  }

  test('a revoked key stops working, and looks like any other refusal', async () => {
    const key = makeTestKey({ status: 'revoked' });
    app = await buildTestServer(key);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verify',
      headers: { 'content-type': 'application/pdf', ...auth(key) },
      payload: await signedPdf(),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthorized' });
  });

  test('an expired key stops working', async () => {
    const key = makeTestKey({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    app = await buildTestServer(key);
    const res = await app.inject({ method: 'GET', url: '/v1/engine', headers: auth(key) });
    expect(res.statusCode).toBe(401);
  });

  test('the probes stay reachable without a key', async () => {
    const key = makeTestKey();
    app = await buildTestServer(key);
    for (const url of ['/livez', '/healthz']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
    }
  });

  test('a public path cannot be reached with a query string trick', async () => {
    const key = makeTestKey();
    app = await buildTestServer(key);
    // `/livez` is public; `/v1/engine?x=/livez` must NOT be.
    const res = await app.inject({ method: 'GET', url: '/v1/engine?x=/livez' });
    expect(res.statusCode).toBe(401);
  });
});

describe('quota (API4)', () => {
  test('exhausting the per-minute allowance answers 429 with Retry-After', async () => {
    const key = makeTestKey({ quotaPerMinute: 2 });
    app = await buildTestServer(key);
    const pdf = await signedPdf();
    const send = () =>
      app!.inject({
        method: 'POST',
        url: '/v1/verify',
        headers: { 'content-type': 'application/pdf', ...auth(key) },
        payload: pdf,
      });

    const first = await send();
    expect(first.statusCode).toBe(200);
    const second = await send();
    expect(second.statusCode).toBe(200);
    expect(second.headers['ratelimit-remaining']).toBe('0');

    const third = await send();
    expect(third.statusCode).toBe(429);
    expect(third.json().error).toBe('rate_limited');
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
  });

  test('the daily allowance is enforced independently of the per-minute one', async () => {
    const key = makeTestKey({ quotaPerMinute: 100, quotaPerDay: 1 });
    app = await buildTestServer(key);
    const pdf = await signedPdf();
    const send = () =>
      app!.inject({
        method: 'POST',
        url: '/v1/verify',
        headers: { 'content-type': 'application/pdf', ...auth(key) },
        payload: pdf,
      });
    const first = await send();
    expect(first.statusCode).toBe(200);
    const second = await send();
    expect(second.statusCode).toBe(429);
  });

  test('one key exhausting its quota does not affect another key', async () => {
    const store = new InMemoryQuotaStore();
    const now = Date.now();
    await store.consume('abuser', 1, 100, now);
    const denied = await store.consume('abuser', 1, 100, now);
    const other = await store.consume('victim', 5, 100, now);
    expect(denied.allowed).toBe(false);
    expect(other.allowed).toBe(true);
  });

  test('the concurrency semaphore bounds in-flight work and releases cleanly', async () => {
    const store = new InMemoryQuotaStore();
    const first = await store.acquireSlot('k', 2);
    const second = await store.acquireSlot('k', 2);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const third = await store.acquireSlot('k', 2);
    expect(third).toBeNull();

    first?.();
    const afterRelease = await store.acquireSlot('k', 2);
    expect(afterRelease).not.toBeNull();
  });

  test('releasing a slot twice cannot inflate the allowance', async () => {
    const store = new InMemoryQuotaStore();
    const release = await store.acquireSlot('k', 1);
    release?.();
    release?.();
    // Exactly one slot must be available, never two.
    const a = await store.acquireSlot('k', 1);
    const b = await store.acquireSlot('k', 1);
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });
});

describe('idempotency', () => {
  test('a retry replays the verdict without spending quota again', async () => {
    const key = makeTestKey({ quotaPerMinute: 2 });
    app = await buildTestServer(key);
    const pdf = await signedPdf();
    const send = () =>
      app!.inject({
        method: 'POST',
        url: '/v1/verify',
        headers: {
          'content-type': 'application/pdf',
          'idempotency-key': 'retry-me-once',
          ...auth(key),
        },
        payload: pdf,
      });

    const first = await send();
    expect(first.statusCode).toBe(200);
    expect(first.headers['idempotent-replay']).toBe('false');

    const replay = await send();
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(first.json());
  });

  test('the same key with a DIFFERENT document is a conflict, not a wrong replay', async () => {
    const key = makeTestKey();
    app = await buildTestServer(key);
    const headers = {
      'content-type': 'application/pdf',
      'idempotency-key': 'same-key-two-docs',
      ...auth(key),
    };
    const first = await app.inject({
      method: 'POST',
      url: '/v1/verify',
      headers,
      payload: await signedPdf(),
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/verify',
      headers,
      payload: await readFile(resolve(FIX, 'hash-mismatch.pdf')),
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('idempotency_conflict');
  });

  test('idempotency is scoped per key: two clients never share a namespace', async () => {
    const store = new InMemoryIdempotencyStore<string>();
    const a = await store.run('keyA', 'shared-id', 'hash', async () => 'A');
    const b = await store.run('keyB', 'shared-id', 'hash', async () => 'B');
    expect(a).toEqual({ kind: 'fresh', value: 'A' });
    expect(b).toEqual({ kind: 'fresh', value: 'B' });
  });

  test('a failed attempt is not cached, so the client can retry', async () => {
    const store = new InMemoryIdempotencyStore<string>();
    await expect(
      store.run('k', 'id', 'hash', async () => {
        throw new Error('transient');
      }),
    ).rejects.toThrow('transient');
    const retry = await store.run('k', 'id', 'hash', async () => 'ok');
    expect(retry).toEqual({ kind: 'fresh', value: 'ok' });
  });
});
