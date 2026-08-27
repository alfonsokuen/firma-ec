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
const MAX_IDEMPOTENCY_KEY_CHARS = 200;

/**
 * Count signature dictionaries WITHOUT parsing the document.
 *
 * This is an admission gate, not verification: a cheap single pass over the
 * bytes looking for `/ByteRange`, so an abusive document is rejected before any
 * expensive work starts. It may over-count (the literal can appear inside a
 * stream), and that is the safe direction for a gate. It cannot under-count in
 * a way that matters: the engine enumerates signatures with the same literal
 * scan, so a dictionary hidden from this counter is hidden from the engine too.
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

/**
 * Shape of what the engine returns. Narrow on purpose: we only inspect the few
 * fields that decide whether this is a verdict or a failure wearing a verdict's
 * clothes.
 */
interface EngineResult {
  signatureCount: number;
  overallStatus: string;
  signatures?: { error?: string }[];
}

/**
 * Turn an engine failure into an HTTP failure.
 *
 * `verifyAllSignatures` NEVER throws: a pre-iteration error comes back as
 * `signatureCount: 0`, `overallStatus: 'invalid'`, and the cause tucked into
 * `signatures[0].error`. Passing that through as a 200 would tell the caller
 * "this signature is INVALID" when what actually happened is that our engine
 * broke — indistinguishable, from their side, from a forged document. For a
 * service whose entire product is trustworthy verdicts, that is the worst
 * failure mode available, so a verdict born of an exception never leaves
 * through the same channel as a computed one.
 *
 * Two different culprits hide in there and they deserve different answers: a
 * malformed document is the caller's problem (4xx); an unexpected exception is
 * ours (5xx).
 */
function classifyEngineFailure(result: EngineResult): VerifyApiError | null {
  if (result.signatureCount > 0) return null;
  const error = result.signatures?.[0]?.error;
  // No signatures and no error is a legitimate answer: an unsigned PDF.
  if (error === undefined || error === '') return null;

  // The engine prefixes the code: `<code>: <message>`. `unknown` means an
  // exception it did not anticipate — that is us failing, not the document.
  if (error.startsWith('unknown:')) {
    return new VerifyApiError('engine_error', 'the verification engine failed');
  }
  return new VerifyApiError('invalid_input', `the document could not be parsed (${error})`);
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

    // ---- Shape checks first. They cost nothing and must not spend quota:
    // charging a client for sending us a JPEG would be indefensible.
    const body = req.body;
    if (!Buffer.isBuffer(body)) {
      throw new VerifyApiError(
        'unsupported_media_type',
        'send the raw PDF with Content-Type: application/pdf',
      );
    }
    if (body.byteLength === 0) throw new VerifyApiError('invalid_input', 'empty body');
    if (body.byteLength > env.MAX_PDF_BYTES) {
      throw new VerifyApiError('payload_too_large', `PDF exceeds ${env.MAX_PDF_BYTES} bytes`);
    }
    if (body.subarray(0, PDF_MAGIC.length).toString('latin1') !== PDF_MAGIC) {
      throw new VerifyApiError('invalid_input', 'body is not a PDF');
    }

    // ---- Admission gate: bound the work BEFORE committing CPU to it. ----
    // Verification cost is O(signatures x bytes); a deadline cannot rescue us
    // when the work is synchronous, because a timer cannot interrupt it
    // (measured: a 700-signature 19MB PDF answered 504 after 176s, having
    // blocked the event loop throughout). So the cost is refused up front.
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

    /**
     * Quota is charged HERE, inside the work, rather than before it.
     *
     * Charged outside, an idempotent replay billed the caller a second time for
     * a verification we never re-ran — contradicting the exact promise the
     * Idempotency-Key exists to make.
     */
    const doVerification = async (): Promise<unknown> => {
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

      // Concurrency slot: the per-minute bucket limits ARRIVALS, not how much
      // heavy work runs at once. Released in `finally` so an exception cannot
      // leak a slot and permanently shrink this key's allowance.
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
      if (idemKey.length > MAX_IDEMPOTENCY_KEY_CHARS) {
        throw new VerifyApiError('invalid_input', 'Idempotency-Key is too long');
      }
      const payloadHash = createHash('sha256').update(body).digest('base64url');
      const outcome = await idempotency.run(key.keyId, idemKey, payloadHash, doVerification);
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
      result = await doVerification();
    }

    // A failure must never leave here dressed as a verdict.
    const verdict = result as EngineResult;
    const failure = classifyEngineFailure(verdict);
    if (failure !== null) {
      if (failure.code === 'engine_error') {
        req.log.error(
          { keyId: key.keyId, engineError: verdict.signatures?.[0]?.error },
          'engine failure returned as a verdict',
        );
      }
      throw failure;
    }

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
