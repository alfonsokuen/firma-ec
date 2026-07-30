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
 *   - Concurrency is 1, enforced HERE by an explicit FIFO queue (`enqueue`
 *     below), not by the caller and not by the shape of the message listener:
 *     an `async` listener does NOT serialise events — two messages that arrive
 *     back to back both enter the handler and interleave at the first `await`.
 *     Relying on that would put two decrypted document buffers in flight at
 *     once the moment the caller's own guard fails (e.g. its `signNext` timed
 *     out while this worker kept signing). The queue makes the invariant a
 *     property of this file.
 *   - `closeSession` ZEROES the retained PKCS#8 DER before dropping the
 *     session, and answers `sessionClosed` so the caller can wait for the wipe
 *     instead of racing it with `terminate()` (F3-7 / ASVS 8.2).
 *
 * Protocol (see ./sign-session-bus.ts for typed contracts):
 *   in  : { kind: 'openSession', p12, pin }
 *       | { kind: 'signNext', requestId, pdf, opts, timestampEnabled, ... }
 *       | { kind: 'closeSession' }
 *   out : { kind: 'sessionOpened' } | { kind: 'sessionOpenError', code, message }
 *       | { kind: 'signProgress', requestId, stage }
 *       | { kind: 'signResult', requestId, signedPdf, timestamp, ltv }
 *       | { kind: 'signError', requestId, code, message }
 *       | { kind: 'sessionClosed' }
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
  const current = session;
  session = null;
  if (!current) return;

  // The PKCS#8 DER IS zeroizable — it's an ArrayBuffer, not a string — and the
  // explicit zero-out is the mitigation this repo commits to (spec F3-7,
  // ASVS 8.2). Overwrite it before dropping the reference: GC alone leaves the
  // plaintext key readable in the heap for an unbounded window.
  const der = current.parsedPfx.privateKeyPkcs8Der;
  if (der instanceof ArrayBuffer && der.byteLength > 0) {
    new Uint8Array(der).fill(0);
  }
  // Any other retained BufferSource-shaped secret gets the same treatment.
  const jwk = (current.parsedPfx as { privateKeyJwk?: unknown }).privateKeyJwk;
  if (jwk instanceof ArrayBuffer) new Uint8Array(jwk).fill(0);
  else if (ArrayBuffer.isView(jwk)) new Uint8Array(jwk.buffer).fill(0);
  // What is NOT zeroizable: JWK **string** fields (`d`, `p`, `q`, …) when the
  // signer hands back a JsonWebKey — JS strings are immutable, so for those we
  // can only drop the reference and let GC reclaim them. That is a known,
  // accepted residual (the DER, which is the full key, is wiped).

  // Caches hold OCSP/CRL responses (public data), but dropping them frees
  // memory immediately rather than at the worker's death.
  current.ocspCache.clear();
  current.crlCache.clear();
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
  // Ack so the caller can await the wipe before terminating this worker.
  post({ kind: 'sessionClosed' });
}

// ---------- Serial task queue (concurrency 1, real) ----------

/**
 * Tail of the task chain. Every inbound message is appended, so message N+1
 * starts only after N has fully settled — including across `await` points,
 * which a plain `async` listener does NOT guarantee.
 */
let queueTail: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void> | void): void {
  queueTail = queueTail.then(task).catch((e) => {
    // Handlers already convert failures into `signError`/`sessionOpenError`
    // messages; anything reaching here would otherwise become an unhandled
    // rejection that silently kills the chain for every later message.
    post({
      kind: 'signError',
      requestId: 'unknown',
      code: 'worker_task_failed',
      message: (e as Error)?.message ?? String(e),
    });
  });
}

ctx.addEventListener('message', (ev: MessageEvent<SignSessionWorkerRequest>) => {
  const req = ev.data;
  if (!req || typeof req !== 'object') return;

  switch (req.kind) {
    case 'openSession':
      enqueue(() => handleOpenSession(req));
      return;
    case 'signNext':
      enqueue(() => handleSignNext(req));
      return;
    case 'closeSession':
      enqueue(() => handleCloseSession());
      return;
    default:
      return;
  }
});
