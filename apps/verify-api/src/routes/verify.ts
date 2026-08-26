/**
 * POST /v1/verify — verify every PAdES signature in a PDF.
 * GET  /v1/engine — the verification engine version behind this deployment.
 *
 * Contract: the request body is the raw PDF (`Content-Type: application/pdf`).
 * No private key is ever accepted here — verification needs only the public
 * material embedded in the document.
 */
import { ENGINE_VERSION, verifyAllSignatures } from '@firma-ec/verifier';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../env.js';
import { VerifyApiError } from '../lib/errors.js';

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

/**
 * Race a verification against a wall-clock ceiling.
 *
 * ⚠️ Read this before trusting it as a resource control: it is NOT one. A timer
 * cannot interrupt synchronous JavaScript, so if the engine is inside a long
 * synchronous stretch the timeout fires only once the event loop is free again.
 * Measured on the unhardened build: a 60s deadline delivered its 504 after
 * 176s. The losing work also keeps running and its CPU is already spent.
 *
 * What actually bounds cost is the admission gate below. This deadline exists
 * for the remaining case — a verification that is slow because of I/O or sheer
 * size — so that a request cannot hang forever, and so a verification that did
 * not finish is never reported as a verdict.
 */
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new VerifyApiError('verify_timeout', `verification exceeded ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export default async function verifyRoutes(
  app: FastifyInstance,
  opts: { env: Env },
): Promise<void> {
  const { env } = opts;

  app.get('/v1/engine', async () => ({ engineVersion: ENGINE_VERSION }));

  app.post('/v1/verify', async (req) => {
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
    const result = await withDeadline(
      verifyAllSignatures(new Uint8Array(body), { fetchOcsp: env.FETCH_OCSP }),
      env.VERIFY_TIMEOUT_MS,
    );

    // Log the verdict shape only — never anything derived from the document.
    req.log.info(
      {
        signatureCount: result.signatureCount,
        signatureDicts,
        overallStatus: result.overallStatus,
        bytes: body.byteLength,
        durationMs: Date.now() - started,
      },
      'verified',
    );

    return result;
  });
}
