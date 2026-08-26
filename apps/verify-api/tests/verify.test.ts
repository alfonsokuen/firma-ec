/**
 * Spike acceptance tests for verify-api.
 *
 * These assert BOTH directions on purpose. A verifier exercised only with good
 * signatures is the exact failure mode that let another module hand a
 * "compatible" verdict to a self-signed certificate: the green case proves
 * nothing on its own, so every good-PDF assertion here is paired with a
 * tampered one that must come back `invalid`.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type TestKey, auth, buildTestServer, makeTestKey } from './helpers.js';

const FIX = resolve(__dirname, '../../../packages/verifier/tests/fixtures');
const pdf = (name: string): Promise<Buffer> => readFile(resolve(FIX, name));

let app: FastifyInstance;
let key: TestKey;

beforeAll(async () => {
  process.env['NODE_ENV'] = 'test';
  key = makeTestKey();
  app = await buildTestServer(key);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('trust anchors load in Node (the ?raw risk)', () => {
  test('GET /healthz reports a non-empty anchor set', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.anchorCount).toBeGreaterThan(0);
  });

  test('GET /v1/engine exposes the engine version', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/engine', headers: auth(key) });
    expect(res.statusCode).toBe(200);
    expect(res.json().engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('POST /v1/verify — the two directions', () => {
  test('GREEN: a REAL Ecuadorian signature is trusted and its signer identified', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verify',
      headers: { 'content-type': 'application/pdf', ...auth(key) },
      payload: await pdf('eci-real-signed.pdf'),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.signatureCount).toBeGreaterThan(0);
    expect(body.overallStatus).not.toBe('invalid');
    const sig = body.signatures[0];
    expect(sig.integrity.digestMatches).toBe(true);
    // Chains to a real accredited CA — the anchors did their job end to end.
    expect(sig.signer.identity.ace).toBe('ArgosData');
    expect(sig.signer.identity.cedula).toMatch(/^\d{10}$/);
    expect(body.engineVersion).toBeDefined();
  });

  test('RED: an intact PDF signed by an UNTRUSTED root is invalid, not valid', async () => {
    // bb-valid.pdf is synthetic: the bytes are untampered and the signature
    // verifies against its own embedded key — the exact tautology that let
    // another module call a fabricated certificate "compatible". Intact must
    // never be mistaken for trusted, so this has to come back invalid.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verify',
      headers: { 'content-type': 'application/pdf', ...auth(key) },
      payload: await pdf('bb-valid.pdf'),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.signatures[0].integrity.digestMatches).toBe(true);
    expect(body.overallStatus).toBe('invalid');
  });

  test('RED: a tampered PDF is reported invalid, not merely warned about', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verify',
      headers: { 'content-type': 'application/pdf', ...auth(key) },
      payload: await pdf('hash-mismatch.pdf'),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.overallStatus).toBe('invalid');
    expect(body.signatures[0].integrity.digestMatches).toBe(false);
  });

  test('RED: an incrementally tampered PDF never comes back valid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verify',
      headers: { 'content-type': 'application/pdf', ...auth(key) },
      payload: await pdf('incremental-tampered.pdf'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().overallStatus).not.toBe('valid');
  });
});

describe('input handling', () => {
  test('a non-PDF body is rejected as invalid_input', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verify',
      headers: { 'content-type': 'application/pdf', ...auth(key) },
      payload: Buffer.from('this is not a pdf at all'),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('invalid_input');
  });

  test('a JSON content-type is rejected, not silently parsed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verify',
      headers: { 'content-type': 'application/json', ...auth(key) },
      payload: JSON.stringify({ pdf: 'nope' }),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('privacy promise', () => {
  test('the client IP is absent from the request log', async () => {
    const sink = new PassThrough();
    let captured = '';
    sink.on('data', (chunk: Buffer) => {
      captured += chunk.toString('utf8');
    });

    const quiet = await buildTestServer(key, { logStream: sink });
    await quiet.ready();
    await quiet.inject({
      method: 'POST',
      url: '/v1/verify',
      headers: {
        'content-type': 'application/pdf',
        'x-forwarded-for': '203.0.113.7',
        ...auth(key),
      },
      payload: await pdf('eci-real-signed.pdf'),
    });
    await quiet.close();
    await new Promise((r) => setTimeout(r, 50));

    expect(captured).not.toContain('203.0.113.7');
    expect(captured).not.toContain('remoteAddress');
  });
});
