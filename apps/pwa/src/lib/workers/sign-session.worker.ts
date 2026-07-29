/**
 * sign-session.worker.ts — batch-signing session worker.
 *
 * Long-lived counterpart to sign.worker.ts: instead of terminating after one
 * signing attempt, this worker stays alive for the duration of a batch and
 * keeps the parsed .p12 (and per-session OCSP/CRL caches) in module state
 * across multiple `signNext` messages. The caller (sign-session-bus.ts /
 * sign-queue.ts) owns the lifetime: it MUST call `closeSession` + terminate
 * the worker when the batch finishes (or on error), same discipline
 * `runSign` enforces for the single-shot worker.
 *
 * Security model — what's DIFFERENT from sign.worker.ts and why it's safe:
 *   - The parsed .p12 (cert chain + private key material as JWK / PKCS#8,
 *     per `@firma-ec/signer`'s ParsedPfx shape) lives in this worker's module
 *     scope for the session's duration, not just one message. It NEVER
 *     leaves the worker — no response message ever includes it.
 *   - The actual WebCrypto `CryptoKey` handle is imported fresh (extractable:
 *     false) inside `signPdfPades`/`addIncrementalSignature` for EACH
 *     document, same as the single-shot path — this worker does not
 *     pre-import or cache a CryptoKey object itself, so that invariant is
 *     unchanged from sign.worker.ts.
 *   - The PIN is used once (during `openSession`, to unwrap the PFX) and is
 *     never stored — only the *result* of `parsePfx` is retained.
 *   - Concurrency is 1: `signNext` requests are processed strictly in
 *     arrival order (single message handler, awaited before the next line
 *     of work). No two documents share a decrypted buffer at once.
 *
 * Protocol (see ./sign-session-bus.ts for typed contracts):
 *   in  : { kind: 'openSession', p12, pin }
 *       | { kind: 'signNext', requestId, pdf, opts, timestampEnabled, ... }
 *       | { kind: 'closeSession' }
 *   out : { kind: 'sessionOpened' } | { kind: 'sessionOpenError', code, message }
 *       | { kind: 'signProgress', requestId, stage }
 *       | { kind: 'signResult', requestId, signedPdf, timestamp, ltv }
 *       | { kind: 'signError', requestId, code, message }
 */

import {
  type CrlCache,
  type LtvMeta,
  type OcspCache,
  type PadesSignOptions,
  type ParsedPfx,
  SignerError,
  type TimestampMeta,
  addIncrementalSignature,
  createCrlCache,
  createOcspCache,
  detectSignatures,
  ltvNotApplicable,
  parsePfx,
  signPdfPades,
} from '@firma-ec/signer';
import type {
  SignNextRequest,
  SignSessionWorkerRequest,
  SignSessionWorkerResponse,
} from './sign-session-bus';

type ParsedPfxFull = ParsedPfx & { privateKeyPkcs8Der: ArrayBuffer };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: SignSessionWorkerResponse, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    ctx.postMessage(msg, transfer);
  } else {
    ctx.postMessage(msg);
  }
}

// ---------- Session state (module scope — lives for the worker's lifetime) ----------

interface SessionState {
  parsedPfx: ParsedPfxFull;
  ocspCache: OcspCache;
  crlCache: CrlCache;
}

let session: SessionState | null = null;

function wipeSession(): void {
  // Best-effort scrub: JWK is a plain object, we can't "zero" a JS string,
  // but dropping every reference (incl. the caches) lets GC reclaim it
  // immediately instead of it lingering for the worker's remaining lifetime.
  session = null;
}

async function handleOpenSession(req: { p12: ArrayBuffer; pin: string }): Promise<void> {
  if (session) {
    // Reopening mid-session is a caller bug — refuse rather than silently
    // discarding the previous session's caches.
    post({
      kind: 'sessionOpenError',
      code: 'session_already_open',
      message: 'openSession called while a session is already open',
    });
    return;
  }
  try {
    const parsedPfx = (await parsePfx(new Uint8Array(req.p12), req.pin)) as ParsedPfxFull;
    session = {
      parsedPfx,
      ocspCache: createOcspCache(),
      crlCache: createCrlCache(),
    };
    post({ kind: 'sessionOpened' });
  } catch (e) {
    if (e instanceof SignerError) {
      post({ kind: 'sessionOpenError', code: e.code, message: e.message });
      return;
    }
    const err = e as Error & { code?: string };
    post({
      kind: 'sessionOpenError',
      code: err.code ?? 'unknown',
      message: err.message ?? String(e),
    });
  }
}

async function handleSignNext(req: SignNextRequest): Promise<void> {
  const { requestId } = req;

  if (!session) {
    post({
      kind: 'signError',
      requestId,
      code: 'session_not_open',
      message: 'signNext called before openSession succeeded',
    });
    return;
  }
  const { parsedPfx, ocspCache, crlCache } = session;

  try {
    post({ kind: 'signProgress', requestId, stage: 'parse_p12' }); // already parsed — informational marker for UI continuity
    post({ kind: 'signProgress', requestId, stage: 'parse_pdf' });
    const pdfBytes = new Uint8Array(req.pdf);
    const prior = await detectSignatures(pdfBytes);

    const timestampEnabled = req.timestampEnabled !== false;
    const tsaUrl = req.tsaUrl;
    const tsaTimeoutMs = req.tsaTimeoutMs;

    const ltvEnabled = req.ltvEnabled !== false;
    const ltvArchiveEnabled = ltvEnabled && req.ltvArchiveEnabled !== false;
    const ltvTimeoutMs = req.ltvTimeoutMs;
    const ocspUrlOverride = req.ocspUrl && req.ocspUrl.length > 0 ? req.ocspUrl : undefined;

    let timestampReceived = false;
    const onTimestampResult = (): void => {
      if (timestampReceived) return;
      timestampReceived = true;
      post({ kind: 'signProgress', requestId, stage: 'request_timestamp' });
    };

    const padesOpts: PadesSignOptions = {
      ...(req.opts?.reason !== undefined ? { reason: req.opts.reason } : {}),
      ...(req.opts?.location !== undefined ? { location: req.opts.location } : {}),
      ...(req.opts?.contactInfo !== undefined ? { contactInfo: req.opts.contactInfo } : {}),
      ...(req.opts?.signingTime !== undefined
        ? { signingTime: new Date(req.opts.signingTime) }
        : {}),
      ...(req.opts?.sigAlg !== undefined ? { sigAlg: req.opts.sigAlg } : {}),
      ...(req.opts?.visibleSig !== undefined
        ? { visibleSig: { ...req.opts.visibleSig, signerCN: parsedPfx.signingCert.subjectCN } }
        : {}),
      timestamp: timestampEnabled,
      ...(tsaUrl !== undefined ? { tsaUrl } : {}),
      ...(tsaTimeoutMs !== undefined ? { tsaTimeoutMs } : {}),
      onTimestampResult,
      // F-batch — reuse the session's OCSP/CRL caches across every document
      // signed with this same .p12 (respects each cache entry's own TTL —
      // see @firma-ec/ltv-validation's createOcspCache/createCrlCache).
      ltv: {
        longTerm: ltvEnabled,
        longTermArchive: ltvArchiveEnabled,
        ...(ltvTimeoutMs !== undefined ? { ocspTimeoutMs: ltvTimeoutMs, ltvTimeoutMs } : {}),
        ...(ocspUrlOverride ? { ocspUrl: ocspUrlOverride } : {}),
        ocspCache,
        crlCache,
        onLtvResult: (): void => {
          /* no-op — coarse progress markers are posted around the signer calls below */
        },
      },
    };

    post({ kind: 'signProgress', requestId, stage: 'compute_hash' });
    post({ kind: 'signProgress', requestId, stage: 'sign' });

    let signed: Uint8Array;
    let timestamp: TimestampMeta;
    let ltv: LtvMeta;
    if (prior.length > 0) {
      signed = await addIncrementalSignature(pdfBytes, parsedPfx, padesOpts);
      timestamp = { ok: false, reason: timestampEnabled ? 'multifirma_path' : 'user_disabled' };
      ltv = ltvNotApplicable('B-B');
    } else {
      if (timestampEnabled) {
        timestampReceived = true;
        post({ kind: 'signProgress', requestId, stage: 'request_timestamp' });
      }
      if (ltvEnabled) {
        post({ kind: 'signProgress', requestId, stage: 'fetch_ocsp' });
      }
      const sres = await signPdfPades(pdfBytes, parsedPfx, padesOpts);
      signed = sres.signedPdf;
      timestamp = sres.timestamp;
      ltv = sres.ltv;
      if (ltv.archiveAchieved) {
        post({ kind: 'signProgress', requestId, stage: 'document_timestamp' });
      } else if (ltv.longTermAchieved) {
        post({ kind: 'signProgress', requestId, stage: 'build_dss' });
      }
      if (!timestamp.ok && timestamp.reason === 'disabled' && !timestampEnabled) {
        timestamp = { ...timestamp, reason: 'user_disabled' };
      }
    }

    post({ kind: 'signProgress', requestId, stage: 'embed' });

    const out: ArrayBuffer = signed.slice().buffer as ArrayBuffer;

    post({ kind: 'signProgress', requestId, stage: 'done' });
    post({ kind: 'signResult', requestId, signedPdf: out, timestamp, ltv }, [out]);
  } catch (e) {
    if (e instanceof SignerError) {
      post({ kind: 'signError', requestId, code: e.code, message: e.message });
      return;
    }
    const err = e as Error & { code?: string };
    post({
      kind: 'signError',
      requestId,
      code: err.code ?? 'unknown',
      message: err.message ?? String(e),
    });
  }
}

function handleCloseSession(): void {
  wipeSession();
}

ctx.addEventListener('message', async (ev: MessageEvent<SignSessionWorkerRequest>) => {
  const req = ev.data;
  if (!req || typeof req !== 'object') return;

  switch (req.kind) {
    case 'openSession':
      await handleOpenSession(req);
      return;
    case 'signNext':
      await handleSignNext(req);
      return;
    case 'closeSession':
      handleCloseSession();
      return;
    default:
      return;
  }
});
