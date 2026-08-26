/**
 * The admission gate, tested against a document the engine would REALLY chew on.
 *
 * This exists because the obvious version of this test is a trap. A hand-rolled
 * PDF with a few `/ByteRange` dictionaries is rejected by the parser before any
 * work happens, so the gate "passes" while proving nothing — and the failure is
 * disguised: `verifyAllSignatures` reports `signatureCount: 0` and
 * `overallStatus: 'invalid'`, which reads like "no signatures here" rather than
 * "your fixture is malformed".
 *
 * So each case below is paired: the SAME document is first shown to be
 * genuinely processable (the engine counts every signature), and only then is
 * the gate shown to refuse it. Without the first half, the second half is
 * indistinguishable from a document the engine was going to drop anyway.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { auth, buildTestServer, makeTestKey, testEnv } from './helpers.js';

const SIGNATURES = 12;
let workDir: string;
let bomb: Buffer;

beforeAll(() => {
  workDir = mkdtempSync(resolve(tmpdir(), 'verify-api-bomb-'));
  const out = resolve(workDir, 'bomb.pdf');
  // Small padding: the point is the signature COUNT, not the file size, and a
  // multi-megabyte fixture would make the suite slow for nothing.
  execFileSync(
    process.execPath,
    [resolve(__dirname, '../scripts/craft-signature-bomb.mjs'), String(SIGNATURES), '20000', out],
    { stdio: 'pipe' },
  );
  bomb = readFileSync(out);
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const key = makeTestKey();

const send = (a: FastifyInstance) =>
  a.inject({
    method: 'POST',
    url: '/v1/verify',
    headers: { 'content-type': 'application/pdf', ...auth(key) },
    payload: bomb,
  });

describe('the admission gate refuses work the engine would otherwise do', () => {
  test('CONTROL: with the gate open, the engine really processes every signature', async () => {
    app = await buildTestServer(key, {
      env: testEnv({ MAX_SIGNATURES: SIGNATURES + 10, MAX_VERIFY_WORK_BYTES: 500_000_000 }),
    });
    const res = await send(app);
    expect(res.statusCode).toBe(200);
    // This is the assertion that makes the next test meaningful: the document
    // is real work, not something the parser throws away.
    expect(res.json().signatureCount).toBe(SIGNATURES);
  });

  test('with the gate at its default, the same document is refused up front', async () => {
    app = await buildTestServer(key, { env: testEnv({ MAX_SIGNATURES: 10 }) });
    const started = Date.now();
    const res = await send(app);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('too_many_signatures');
    // Refusing must cost far less than doing the work.
    expect(Date.now() - started).toBeLessThan(500);
  });

  test('the work budget refuses on size x count even when the count alone fits', async () => {
    app = await buildTestServer(key, {
      env: testEnv({ MAX_SIGNATURES: SIGNATURES + 10, MAX_VERIFY_WORK_BYTES: 100_000 }),
    });
    const res = await send(app);
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe('document_too_costly');
  });
});
