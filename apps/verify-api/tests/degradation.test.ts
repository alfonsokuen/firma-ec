/**
 * Degradations that used to look exactly like success.
 *
 * This service answers questions about the validity of electronic signatures,
 * so its worst failure is not a crash — it is saying "invalid" or "untrusted"
 * confidently, for a reason that has nothing to do with the document. Every
 * test here drives a real degradation and asserts the service SAYS SO, instead
 * of quietly returning a verdict.
 */
import { getTrustRoots } from '@firma-ec/tsl-ec';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, test } from 'vitest';
import type { AnchorReport } from '../src/lib/trustAnchors.js';
import { inspectTrustAnchors } from '../src/lib/trustAnchors.js';
import { InMemoryQuotaStore } from '../src/services/quota.js';
import type { VerifyRunner } from '../src/services/verifyRunner.js';
import { type TestKey, auth, buildTestServer, makeTestKey, testEnv } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const stubRunner = (result: unknown): VerifyRunner => ({
  run: async () => result,
  isReady: () => true,
  close: async () => {},
});

const pdf = (): Buffer => Buffer.from('%PDF-1.7\nnot really a document\n', 'latin1');

const post = (a: FastifyInstance, key: TestKey, headers: Record<string, string> = {}) =>
  a.inject({
    method: 'POST',
    url: '/v1/verify',
    headers: { 'content-type': 'application/pdf', ...auth(key), ...headers },
    payload: pdf(),
  });

describe('trust anchors — the detector must fire, not just exist', () => {
  test('CONTROL: the real anchor set is fully usable today', async () => {
    const report = await inspectTrustAnchors();
    expect(report.declared).toBeGreaterThan(0);
    expect(report.usable).toBe(report.declared);
    expect(report.problems).toEqual([]);
  });

  test('RED: a fingerprint that no longer matches is refused and named', async () => {
    // Silent certificate substitution is the attack this guards against, and
    // the symptom without it is "legitimate signatures are untrusted".
    const roots = await getTrustRoots();
    const tampered = roots.map((r, i) =>
      i === 0 && !r.isPlaceholder ? { ...r, fingerprintSha256: 'deadbeef'.repeat(8) } : r,
    );
    const report = await inspectTrustAnchors(tampered);
    expect(report.usable).toBe(report.declared - 1);
    expect(report.problems.join(' ')).toContain('fingerprint mismatch');
  });

  test('RED: an anchor whose PEM does not parse is refused and named', async () => {
    const roots = await getTrustRoots();
    const broken = roots.map((r, i) =>
      i === 0 && !r.isPlaceholder ? { ...r, pemContent: '' } : r,
    );
    const report = await inspectTrustAnchors(broken);
    expect(report.usable).toBe(report.declared - 1);
    expect(report.problems).toHaveLength(1);
  });

  test('/healthz goes RED on partial anchor loss, not merely on total loss', async () => {
    // The old check counted array entries, a structural constant, so it read
    // "ok" even with every PEM emptied.
    const degraded: AnchorReport = { declared: 28, usable: 27, problems: ['bce: broken'] };
    const key = makeTestKey();
    app = await buildTestServer(key, { overrides: { inspectAnchors: async () => degraded } });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    expect(res.json().reason).toBe('trust_anchors_degraded');
    expect(res.json().usableAnchors).toBe(27);
  });

  test('/healthz goes RED when nothing is trustworthy at all', async () => {
    const none: AnchorReport = { declared: 28, usable: 0, problems: [] };
    const key = makeTestKey();
    app = await buildTestServer(key, { overrides: { inspectAnchors: async () => none } });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    expect(res.json().reason).toBe('no_trust_anchors');
  });
});

describe('an engine failure never leaves dressed as a verdict', () => {
  test('an unexpected engine exception becomes 502, not "signature invalid"', async () => {
    // `verifyAllSignatures` never throws: it returns overallStatus 'invalid'
    // with the cause in signatures[0].error. Forwarding that as 200 would tell
    // the caller their document is forged when our engine simply broke.
    const key = makeTestKey();
    app = await buildTestServer(key, {
      overrides: {
        runner: stubRunner({
          signatureCount: 0,
          overallStatus: 'invalid',
          signatures: [{ status: 'invalid', error: 'unknown: cannot read properties of null' }],
        }),
      },
    });
    const res = await post(app, key);
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('engine_error');
    // The internal message must not reach the caller.
    expect(res.body).not.toContain('cannot read properties');
  });

  test('a malformed document is the CALLER’s error, not ours', async () => {
    const key = makeTestKey();
    app = await buildTestServer(key, {
      overrides: {
        runner: stubRunner({
          signatureCount: 0,
          overallStatus: 'invalid',
          signatures: [{ status: 'invalid', error: 'byterange_invalid: /ByteRange mismatch' }],
        }),
      },
    });
    const res = await post(app, key);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('invalid_input');
  });

  test('an unsigned PDF is a legitimate 200, not a failure', async () => {
    const key = makeTestKey();
    app = await buildTestServer(key, {
      overrides: {
        runner: stubRunner({ signatureCount: 0, overallStatus: 'no_signature', signatures: [] }),
      },
    });
    const res = await post(app, key);
    expect(res.statusCode).toBe(200);
    expect(res.json().overallStatus).toBe('no_signature');
  });
});

describe('quota is charged for work, not for mistakes or replays', () => {
  const okResult = { signatureCount: 1, overallStatus: 'valid', signatures: [{}] };

  test('a replayed request does not spend a second unit of quota', async () => {
    const key = makeTestKey({ quotaPerMinute: 2 });
    app = await buildTestServer(key, { overrides: { runner: stubRunner(okResult) } });
    const headers = { 'idempotency-key': 'same-work-twice' };

    const first = await post(app, key, headers);
    expect(first.statusCode).toBe(200);
    expect(first.headers['ratelimit-remaining']).toBe('1');

    const replay = await post(app, key, headers);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');

    // Two calls, ONE unit spent: a third distinct request must still be allowed.
    const third = await post(app, key, { 'idempotency-key': 'different-work' });
    expect(third.statusCode).toBe(200);
  });

  test('a rejected request does not spend quota', async () => {
    const key = makeTestKey({ quotaPerMinute: 1 });
    const quotaStore = new InMemoryQuotaStore();
    app = await buildTestServer(key, {
      overrides: { runner: stubRunner(okResult), quotaStore },
    });
    // Not a PDF: refused on shape, before any accounting.
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/verify',
      headers: { 'content-type': 'application/pdf', ...auth(key) },
      payload: Buffer.from('this is not a pdf'),
    });
    expect(bad.statusCode).toBe(422);

    // The single unit of quota must still be available.
    const good = await post(app, key);
    expect(good.statusCode).toBe(200);
  });
});

describe('the backstop limiter actually sees unauthenticated traffic', () => {
  test('anonymous requests are limited, not just refused', async () => {
    // Registered after the auth hook, the limiter never saw anonymous traffic:
    // measured, 10 requests over a limit of 3 produced ten 401s and zero 429s.
    const key = makeTestKey();
    app = await buildTestServer(key, {
      env: testEnv({ RATE_LIMIT_PER_MINUTE: 3 }),
      disableRateLimit: false,
    });
    const codes: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const res = await app.inject({ method: 'GET', url: '/v1/engine' });
      codes.push(res.statusCode);
    }
    expect(codes).toContain(401);
    expect(codes).toContain(429);
  });

  test('an authenticated client is bucketed by its key, not by the shared socket', async () => {
    const a = makeTestKey();
    const b = makeTestKey();
    app = await buildTestServer(a, {
      env: testEnv({ RATE_LIMIT_PER_MINUTE: 2 }),
      disableRateLimit: false,
      overrides: {
        keyStore: {
          findByKeyId: async (id) =>
            id === a.record.keyId ? a.record : id === b.record.keyId ? b.record : null,
        },
      },
    });

    // Burn A's backstop allowance.
    for (let i = 0; i < 3; i += 1) {
      await app.inject({ method: 'GET', url: '/v1/engine', headers: auth(a) });
    }
    const aLimited = await app.inject({ method: 'GET', url: '/v1/engine', headers: auth(a) });
    expect(aLimited.statusCode).toBe(429);

    // B shares the same socket but must be unaffected.
    const bFine = await app.inject({ method: 'GET', url: '/v1/engine', headers: auth(b) });
    expect(bFine.statusCode).toBe(200);
  });
});
