/**
 * How the route behaves when the verification itself fails or times out.
 *
 * These use an injected runner rather than a real hostile document: the point
 * under test is the ROUTE's contract (status codes, and that a failure still
 * releases the concurrency slot), not the engine's performance. Whether
 * `terminate()` truly reclaims CPU is a property of the built worker and is
 * measured against the bundle, not here.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, test } from 'vitest';
import { VerifyApiError } from '../src/lib/errors.js';
import { InMemoryQuotaStore } from '../src/services/quota.js';
import type { VerifyRunner } from '../src/services/verifyRunner.js';
import { type TestKey, auth, buildTestServer, makeTestKey } from './helpers.js';

const FIX = resolve(__dirname, '../../../packages/verifier/tests/fixtures');
const signedPdf = (): Promise<Buffer> => readFile(resolve(FIX, 'eci-real-signed.pdf'));

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function stubRunner(behaviour: () => Promise<unknown>): VerifyRunner {
  return {
    run: behaviour,
    isReady: () => true,
    close: async () => {},
  };
}

const post = (a: FastifyInstance, key: TestKey, pdf: Buffer) =>
  a.inject({
    method: 'POST',
    url: '/v1/verify',
    headers: { 'content-type': 'application/pdf', ...auth(key) },
    payload: pdf,
  });

describe('verification failures', () => {
  test('a timed-out verification answers 504, never a verdict', async () => {
    const key = makeTestKey();
    app = await buildTestServer(key, {
      overrides: {
        runner: stubRunner(async () => {
          throw new VerifyApiError('verify_timeout', 'exceeded');
        }),
      },
    });
    const res = await post(app, key, await signedPdf());
    expect(res.statusCode).toBe(504);
    expect(res.json().error).toBe('verify_timeout');
  });

  test('an engine crash is opaque to the caller but not silent to us', async () => {
    const key = makeTestKey();
    app = await buildTestServer(key, {
      overrides: {
        runner: stubRunner(async () => {
          throw new Error('worker exploded with /srv/secret/path detail');
        }),
      },
    });
    const res = await post(app, key, await signedPdf());
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal' });
    // Internal detail must never reach the wire.
    expect(res.body).not.toContain('/srv/secret/path');
  });

  test('a failed verification still releases its concurrency slot', async () => {
    const key = makeTestKey({ maxConcurrent: 1, quotaPerMinute: 10 });
    const quotaStore = new InMemoryQuotaStore();
    let attempts = 0;
    app = await buildTestServer(key, {
      overrides: {
        quotaStore,
        runner: stubRunner(async () => {
          attempts += 1;
          if (attempts === 1) throw new VerifyApiError('verify_timeout', 'exceeded');
          return { signatureCount: 1, overallStatus: 'valid' };
        }),
      },
    });

    const pdf = await signedPdf();
    const failed = await post(app, key, pdf);
    expect(failed.statusCode).toBe(504);

    // If the slot had leaked, this second call would be refused for
    // concurrency even though nothing is running.
    const second = await post(app, key, pdf);
    expect(second.statusCode).toBe(200);
  });

  test('a failed verification is not cached under its idempotency key', async () => {
    const key = makeTestKey();
    let attempts = 0;
    app = await buildTestServer(key, {
      overrides: {
        runner: stubRunner(async () => {
          attempts += 1;
          if (attempts === 1) throw new VerifyApiError('verify_timeout', 'exceeded');
          return { signatureCount: 1, overallStatus: 'valid' };
        }),
      },
    });
    const pdf = await signedPdf();
    const headers = {
      'content-type': 'application/pdf',
      'idempotency-key': 'retry-after-failure',
      ...auth(key),
    };
    const first = await app.inject({ method: 'POST', url: '/v1/verify', headers, payload: pdf });
    expect(first.statusCode).toBe(504);

    const retry = await app.inject({ method: 'POST', url: '/v1/verify', headers, payload: pdf });
    expect(retry.statusCode).toBe(200);
  });
});

describe('readiness reflects the runner', () => {
  test('/healthz reports unhealthy when the runner cannot execute', async () => {
    const key = makeTestKey();
    app = await buildTestServer(key, {
      overrides: {
        runner: {
          run: async () => ({}),
          isReady: () => false,
          close: async () => {},
        },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    expect(res.json().reason).toBe('verify_runner_unavailable');
  });
});
