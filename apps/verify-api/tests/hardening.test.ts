/**
 * Regression guards for the OWASP hardening pass.
 *
 * Every test here reproduces a weakness that was CONFIRMED by attacking the
 * running service, not a hypothetical one. The headline finding: a single
 * anonymous 19MB PDF carrying 700 signature dictionaries blocked the event loop
 * for 176s and starved the liveness probe — the 60s deadline could not help,
 * because a timer cannot interrupt synchronous work.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, test } from 'vitest';
import type { Env } from '../src/env.js';
import { type TestKey, auth, buildTestServer, makeTestKey, testEnv } from './helpers.js';

const FIX = resolve(__dirname, '../../../packages/verifier/tests/fixtures');

let app: FastifyInstance | undefined;
const key: TestKey = makeTestKey();

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const envWith = (over: Partial<Env>): Env => testEnv(over);

/**
 * A document declaring `count` signatures. It does NOT need to be a parseable
 * PDF: the whole point of the admission gate is that it decides BEFORE the
 * parser is ever handed the bytes.
 */
function signatureBomb(count: number, padBytes = 0): Buffer {
  const dict = '/ByteRange [0 100 200 300] /Contents <00> ';
  return Buffer.concat([
    Buffer.from('%PDF-1.7\n', 'latin1'),
    Buffer.from(dict.repeat(count), 'latin1'),
    Buffer.alloc(padBytes, 0x20),
  ]);
}

describe('admission gate — bounded work (API4: unrestricted resource consumption)', () => {
  test('a signature bomb is refused, and refused FAST', async () => {
    app = await buildTestServer(key, { env: envWith({ MAX_SIGNATURES: 10 }) });
    const started = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verify',
      headers: { 'content-type': 'application/pdf', ...auth(key) },
      payload: signatureBomb(700),
    });
    const elapsedMs = Date.now() - started;

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('too_many_signatures');
    // The old code spent 176s on this shape of input. Rejecting must be cheap.
    expect(elapsedMs).toBeLessThan(1000);
  });

  test('signatures x bytes is bounded TOGETHER, not just each alone', async () => {
    // Few enough signatures to pass the count cap, big enough that the product
    // is what makes it expensive — the dimension a per-count cap alone misses.
    app = await buildTestServer(key, {
      env: envWith({ MAX_SIGNATURES: 10, MAX_VERIFY_WORK_BYTES: 100_000 }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verify',
      headers: { 'content-type': 'application/pdf', ...auth(key) },
      payload: signatureBomb(5, 200_000),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe('document_too_costly');
  });

  test('a legitimate signed PDF still passes the gate', async () => {
    app = await buildTestServer(key);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verify',
      headers: { 'content-type': 'application/pdf', ...auth(key) },
      payload: await readFile(resolve(FIX, 'eci-real-signed.pdf')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().overallStatus).not.toBe('invalid');
  });
});

describe('availability of the health probes under load', () => {
  test('the rate limiter never answers /livez or /healthz with 429', async () => {
    app = await buildTestServer(key, {
      env: envWith({ RATE_LIMIT_PER_MINUTE: 1 }),
      disableRateLimit: false,
    });
    // Burn the budget well past the limit.
    for (let i = 0; i < 5; i += 1) {
      await app.inject({ method: 'GET', url: '/v1/engine', headers: auth(key) });
    }
    for (const url of ['/livez', '/healthz']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, `${url} must stay reachable`).toBe(200);
    }
  });

  test('an exhausted budget answers with the documented code, not {"error":"error"}', async () => {
    app = await buildTestServer(key, {
      env: envWith({ RATE_LIMIT_PER_MINUTE: 1 }),
      disableRateLimit: false,
    });
    let limited: { statusCode: number; body: string } | undefined;
    for (let i = 0; i < 5 && limited === undefined; i += 1) {
      const res = await app.inject({ method: 'GET', url: '/v1/engine', headers: auth(key) });
      if (res.statusCode === 429) limited = { statusCode: res.statusCode, body: res.body };
    }
    expect(limited).toBeDefined();
    expect(JSON.parse(limited!.body).error).toBe('rate_limited');
  });
});

describe('information disclosure (API3 / API8)', () => {
  test('a 404 does not echo the requested path back', async () => {
    app = await buildTestServer(key);
    const res = await app.inject({ method: 'GET', url: '/etc/passwd', headers: auth(key) });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('/etc/passwd');
    expect(res.json().error).toBe('not_found');
  });

  test('an anonymous caller cannot even enumerate routes', async () => {
    // The auth hook runs on onRequest, ahead of the router, so an unknown path
    // and a real one are indistinguishable without a key.
    app = await buildTestServer(key);
    const missing = await app.inject({ method: 'GET', url: '/etc/passwd' });
    const real = await app.inject({ method: 'GET', url: '/v1/engine' });
    expect(missing.statusCode).toBe(401);
    expect(real.statusCode).toBe(401);
    expect(missing.body).toBe(real.body);
  });

  test('a wrong media type maps to our code, not a framework code', async () => {
    app = await buildTestServer(key);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verify',
      headers: { 'content-type': 'application/json', ...auth(key) },
      payload: '{}',
    });
    expect(res.statusCode).toBe(415);
    expect(res.body).not.toContain('FST_ERR');
    expect(res.json().error).toBe('unsupported_media_type');
  });
});
