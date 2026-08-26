/**
 * POST /v1/verify — verify every PAdES signature in a PDF.
 * GET  /v1/engine — the verification engine version behind this deployment.
 *
 * Contract: the request body is the raw PDF (`Content-Type: application/pdf`).
 * No private key is ever accepted here — verification needs only the public
 * material embedded in the document.
 */
import { createHash } from 'node:crypto';
import { ENGINE_VERSION } from '@firma-ec/verifier';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../env.js';
import { VerifyApiError } from '../lib/errors.js';
import type { InMemoryIdempotencyStore } from '../services/idempotency.js';
import type { QuotaStore } from '../services/quota.js';
import type { VerifyRunner } from '../services/verifyRunner.js';

const PDF_MAGIC = '%PDF-';

/**
 * Count signature dictionaries WITHOUT parsing the document.
 *
 * This is an admission gate, not verification: a cheap single pass over the
 * bytes looking for `/ByteRange`, so an abusive document is rejected before any
 * expensive work starts. It may over-count (the literal can appear inside a
 * stream), and that is the safe direction for a gate — a document with dozens
 * of these is refused either way. The authoritative count comes from the
 * verifier itself, afterwards.
 */
function countSignatureDicts(pdf: Buffer): number {
  const needle = Buffer.from('/ByteRange', 'latin1');
  let count = 0;
  let at = pdf.indexOf(needle, 0);
  while (at !== -1) {
    count += 1;
    // A gate only needs to know "too many", so stop early instead of scanning
    // the rest of a 20MB buffer once the answer can no longer change.
    if (count > 1000) return count;
    at = pdf.indexOf(needle, at + needle.length);
  }
  return count;
}

export interface VerifyRoutesOpts {
  env: Env;
  quotaStore: QuotaStore;
  idempotency: InMemoryIdempotencyStore<unknown>;
  runner: VerifyRunner;
}

export default async function verifyRoutes(
  app: FastifyInstance,
  opts: VerifyRoutesOpts,
): Promise<void> {
  const { env, quotaStore, idempotency, runner } = opts;

  app.get('/v1/engine', async () => ({ engineVersion: ENGINE_VERSION }));

  app.post('/v1/verify', async (req, reply) => {
    // The auth hook guarantees this; the check keeps the invariant explicit
    // rather than trusting a non-null assertion.
    const key = req.apiKey;
    if (key === undefined) throw new VerifyApiError('internal', 'missing authenticated key');

    // ---- Quota, charged BEFORE the work. -------------------------------
    const decision = await quotaStore.consume(
      key.keyId,
      key.quotaPerMinute,
      key.quotaPerDay,
      Date.now(),
    );
    reply.header('RateLimit-Limit', String(key.quotaPerMinute));
    reply.header('RateLimit-Remaining', String(decision.remaining));
    reply.header('RateLimit-Reset', String(decision.resetAt));
    if (!decision.allowed) {
      reply.header('Retry-After', String(decision.retryAfterSeconds));
      throw new VerifyApiError('rate_limited', `quota exhausted (${decision.reason})`);
    }

    const body = req.body;
    if (!Buffer.isBuffer(body)) {
      throw new VerifyApiError(
        'unsupported_media_type',
        'send the raw PDF with Content-Type: application/pdf',
      );
    }
    if (body.byteLength === 0) {
      throw new VerifyApiError('invalid_input', 'empty body');
    }
    if (body.byteLength > env.MAX_PDF_BYTES) {
      throw new VerifyApiError('payload_too_large', `PDF exceeds ${env.MAX_PDF_BYTES} bytes`);
    }
    // Cheap shape check before handing megabytes to the parser.
    if (body.subarray(0, PDF_MAGIC.length).toString('latin1') !== PDF_MAGIC) {
      throw new VerifyApiError('invalid_input', 'body is not a PDF');
    }

    // ---- Admission gate: bound the work BEFORE committing CPU to it. ----
    // Verification cost is O(signatures x bytes); the deadline below cannot
    // rescue us because the work is synchronous and a timer cannot interrupt
    // it (measured: a 700-signature 19MB PDF answered 504 after 176s, having
    // blocked the event loop the whole time). So the cost is refused up front.
    const signatureDicts = countSignatureDicts(body);
    if (signatureDicts > env.MAX_SIGNATURES) {
      throw new VerifyApiError(
        'too_many_signatures',
        `document declares ${signatureDicts} signatures; the limit is ${env.MAX_SIGNATURES}`,
      );
    }
    const workBytes = Math.max(signatureDicts, 1) * body.byteLength;
    if (workBytes > env.MAX_VERIFY_WORK_BYTES) {
      throw new VerifyApiError(
        'document_too_costly',
        'document size times signature count exceeds the verification budget',
      );
    }

    const started = Date.now();

    const runVerification = async (): Promise<unknown> => {
      // Concurrency slot: the per-minute bucket limits ARRIVALS, not how much
      // heavy work runs at once. Released in `finally` so an exception cannot
      // leak a slot and shrink the key's allowance permanently.
      const release = await quotaStore.acquireSlot(key.keyId, key.maxConcurrent);
      if (release === null) {
        throw new VerifyApiError(
          'rate_limited',
          `too many verifications in flight (limit ${key.maxConcurrent})`,
        );
      }
      try {
        return await runner.run(body, env.FETCH_OCSP, env.VERIFY_TIMEOUT_MS);
      } finally {
        release();
      }
    };

    // ---- Idempotency: a retry must not re-run the work nor charge twice. --
    const idemKey = req.headers['idempotency-key'];
    let result: unknown;
    let replayed = false;
    if (typeof idemKey === 'string' && idemKey !== '') {
      const payloadHash = createHash('sha256').update(body).digest('base64url');
      const outcome = await idempotency.run(key.keyId, idemKey, payloadHash, runVerification);
      if (outcome.kind === 'conflict') {
        throw new VerifyApiError(
          'idempotency_conflict',
          'this Idempotency-Key was already used with a different document',
        );
      }
      if (outcome.kind === 'in_flight') {
        reply.header('Retry-After', '5');
        throw new VerifyApiError(
          'idempotency_in_flight',
          'a request with this Idempotency-Key is still running',
        );
      }
      replayed = outcome.kind === 'replayed';
      result = outcome.value;
    } else {
      result = await runVerification();
    }

    const verdict = result as { signatureCount: number; overallStatus: string };
    // Log the verdict shape only — never anything derived from the document.
    req.log.info(
      {
        keyId: key.keyId,
        signatureCount: verdict.signatureCount,
        signatureDicts,
        overallStatus: verdict.overallStatus,
        bytes: body.byteLength,
        replayed,
        durationMs: Date.now() - started,
      },
      'verified',
    );

    reply.header('Idempotent-Replay', String(replayed));
    return result;
  });
}
