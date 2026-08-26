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
 * Race a verification against a wall-clock ceiling.
 *
 * The losing verification keeps running to completion in the background — it
 * cannot be cancelled — but its result is discarded. That is deliberate: the
 * alternative is holding the connection open indefinitely, and a verification
 * that did not finish must never be reported as a verdict.
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

    const started = Date.now();
    const result = await withDeadline(
      verifyAllSignatures(new Uint8Array(body), { fetchOcsp: env.FETCH_OCSP }),
      env.VERIFY_TIMEOUT_MS,
    );

    // Log the verdict shape only — never anything derived from the document.
    req.log.info(
      {
        signatureCount: result.signatureCount,
        overallStatus: result.overallStatus,
        bytes: body.byteLength,
        durationMs: Date.now() - started,
      },
      'verified',
    );

    return result;
  });
}
