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
  analyzePdfForPlacement,
  computeAutoPlacement,
  createCrlCache,
  createOcspCache,
  detectSignatures,
  ltvNotApplicable,
  parsePfx,
  signPdfPades,
} from '@firma-ec/signer';
import type { SignVisibleSigInput } from './sign-bus';
import type {
  SignNextRequest,
  SignSessionWorkerRequest,
  SignSessionWorkerResponse,
} from './sign-session-bus';

type ParsedPfxFull = ParsedPfx & { privateKeyPkcs8Der: ArrayBuffer };

/**
 * requestId reported by the last-resort failure handler when nothing is in
 * flight. The bus routes it to whatever signature is pending rather than
 * dropping it (see sign-session-bus.ts) — silence used to turn a real worker
 * error into the caller's generic 'timeout'.
 */
export const UNKNOWN_REQUEST_ID = 'unknown';

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

/**
 * Zero + drop the retained key material.
 *
 * @returns whether the PKCS#8 was actually overwritten. `false` means the
 * mitigation could NOT run (the signer handed back a shape we cannot zero, e.g.
 * a string) — the caller is told so instead of assuming a wipe that never
 * happened. A security mitigation must not fail silently.
 */
function wipeSession(): boolean {
  const current = session;
  session = null;
  if (!current) return true; // nothing retained ⇒ nothing left unwiped

  // The PKCS#8 DER IS zeroizable when it arrives as a buffer (or a view over
  // one) — and the explicit zero-out is the mitigation this repo commits to
  // (spec F3-7, ASVS 8.2). Overwrite it before dropping the reference: GC alone
  // leaves the plaintext key readable in the heap for an unbounded window.
  const der: unknown = current.parsedPfx.privateKeyPkcs8Der;
  let wiped = false;
  if (der instanceof ArrayBuffer) {
    if (der.byteLength > 0) new Uint8Array(der).fill(0);
    wiped = true;
  } else if (ArrayBuffer.isView(der)) {
    // A typed-array view: zero exactly the bytes it spans, not the whole
    // backing buffer (which may be shared with unrelated data).
    new Uint8Array(der.buffer, der.byteOffset, der.byteLength).fill(0);
    wiped = true;
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
  return wiped;
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

    // ---- Colocación automática (lotes) ----
    // El análisis se hace AQUÍ, no en la hebra principal: este worker ya tiene
    // los bytes y ya importa el firmante, así que analizar allá obligaría a
    // transferir el PDF dos veces (ida para analizar, vuelta para firmar).
    let autoVisibleSig: SignVisibleSigInput | undefined;
    if (req.visibleSigAuto) {
      const analysis = await analyzePdfForPlacement(pdfBytes);
      const placement = computeAutoPlacement({
        geometry: analysis.geometry,
        existing: analysis.existing,
        emptySigFields: analysis.emptySigFields,
        textBands: analysis.textBands,
        unanalyzedPages: analysis.unanalyzedPages,
        ...(analysis.failure !== undefined ? { failure: analysis.failure } : {}),
      });

      // Cruce entre los DOS lectores del documento. `detectSignatures` y
      // `analyzePdfForPlacement` lo miran por caminos distintos; si el primero
      // ve firmas previas y el segundo no encuentra ninguna, el análisis se ha
      // perdido algo — y entonces lo que llama "campo de firma vacío" bien
      // puede ser la firma anterior. Como `empty-field` gana sobre todo lo
      // demás, esa confusión colocaba la estampa con el rect EXACTO de la firma
      // existente, encima, y el lote lo contaba como éxito limpio.
      //
      // La guarda se limita a `empty-field` a propósito: una firma previa
      // INVISIBLE (`/Rect [0 0 0 0]`, la forma canónica del §12.7.4.5) también
      // deja `existing` vacío de forma legítima, y ahí el pie de página es la
      // respuesta correcta, no apartar el documento.
      const priorSignaturesUnseenByAnalysis = prior.length > 0 && analysis.existing.length === 0;
      if (
        placement.status === 'ok' &&
        placement.source === 'empty-field' &&
        priorSignaturesUnseenByAnalysis
      ) {
        post({
          kind: 'signNeedsReview',
          requestId,
          page: placement.page,
          reason: 'empty_field_conflicts_with_prior_signature',
        });
        return;
      }

      if (placement.status === 'needs_review') {
        // Este documento NO se firma: colocar la firma mal es peor que no
        // firmarla. No es un error del lote — el llamante lo aparta para que
        // un humano la coloque y sigue con los demás documentos.
        post({
          kind: 'signNeedsReview',
          requestId,
          page: placement.page,
          reason: placement.reason,
        });
        return;
      }
      autoVisibleSig = {
        page: placement.page,
        x: placement.x,
        y: placement.y,
        width: placement.w,
        height: placement.h,
        rotate: placement.rotate,
      };
    }
    // El rect explícito manda sobre la colocación automática: si viene uno, es
    // porque una persona MIRÓ este documento y decidió dónde va la firma, y
    // ninguna heurística debe pisar eso. El bus hace hoy los dos campos
    // mutuamente excluyentes, así que en la práctica solo llega uno; el orden
    // importa igualmente, porque deja escrito quién gana si mañana llegan los
    // dos, en vez de dejarlo a merced de este `??`.
    const visibleSigInput = req.opts?.visibleSig ?? autoVisibleSig;

    const timestampEnabled = req.timestampEnabled !== false;
    const tsaUrl = req.tsaUrl;
    const tsaTimeoutMs = req.tsaTimeoutMs;

    const ltvEnabled = req.ltvEnabled !== false;
    const ltvArchiveEnabled = ltvEnabled && req.ltvArchiveEnabled !== false;
    const ltvTimeoutMs = req.ltvTimeoutMs;
    const ocspUrlOverride = req.ocspUrl && req.ocspUrl.length > 0 ? req.ocspUrl : undefined;

    // Defect #11 — the stage is emitted from the signer's own callback, i.e.
    // AFTER the TSA exchange was actually attempted. Emitting it beforehand made
    // the UI claim network work that, with the timestamp disabled or the
    // multi-signature path taken, never happened.
    let timestampReported = false;
    const onTimestampResult = (): void => {
      if (timestampReported) return;
      timestampReported = true;
      post({ kind: 'signProgress', requestId, stage: 'request_timestamp' });
    };

    /**
     * Same rule for revocation: `onLtvResult` fires once the LT/LTA phase has
     * run, and its meta says whether a lookup really took place (embedded
     * responses, or an ocsp_/crl_-prefixed warning explaining why not).
     */
    const onLtvResult = (meta: LtvMeta): void => {
      const attempted =
        meta.embeddedOcspCount > 0 ||
        meta.embeddedCrlCount > 0 ||
        meta.warnings.some((w) => w.code.startsWith('ocsp_') || w.code.startsWith('crl_'));
      if (attempted) post({ kind: 'signProgress', requestId, stage: 'fetch_ocsp' });
    };

    const padesOpts: PadesSignOptions = {
      ...(req.opts?.reason !== undefined ? { reason: req.opts.reason } : {}),
      ...(req.opts?.location !== undefined ? { location: req.opts.location } : {}),
      ...(req.opts?.contactInfo !== undefined ? { contactInfo: req.opts.contactInfo } : {}),
      ...(req.opts?.signingTime !== undefined
        ? { signingTime: new Date(req.opts.signingTime) }
        : {}),
      ...(req.opts?.sigAlg !== undefined ? { sigAlg: req.opts.sigAlg } : {}),
      ...(visibleSigInput !== undefined
        ? {
            visibleSig: {
              ...visibleSigInput,
              signerCN: parsedPfx.signingCert.subjectCN,
              signerId: parsedPfx.signingCert.holderCedula,
            },
          }
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
        // Aggregate ceiling for the whole LTV phase, anchored HERE (not on the
        // main thread) so the budget covers the network only, not the time the
        // request spent queued behind the previous document.
        ...(req.ltvBudgetMs !== undefined ? { deadlineAt: Date.now() + req.ltvBudgetMs } : {}),
        ...(ocspUrlOverride ? { ocspUrl: ocspUrlOverride } : {}),
        ocspCache,
        crlCache,
        onLtvResult,
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
      // No pre-emptive `request_timestamp` / `fetch_ocsp` here: both stages are
      // emitted by onTimestampResult / onLtvResult once the attempt is real.
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
    const err = e as Error & { code?: string };
    const code = e instanceof SignerError ? e.code : (err.code ?? 'unknown');
    const message = e instanceof SignerError ? e.message : (err.message ?? String(e));
    try {
      post({ kind: 'signError', requestId, code: String(code), message });
    } catch (postErr) {
      // Reporting the failure failed too (a DataCloneError-shaped postMessage).
      // Re-throw carrying BOTH causes: the last-resort handler must not report
      // the messenger's problem as if it were the signature's.
      throw new Error(
        `${message} (and reporting it failed: ${(postErr as Error)?.message ?? String(postErr)})`,
      );
    }
  }
}

function handleCloseSession(): void {
  const wiped = wipeSession();
  if (!wiped) {
    // No document data, no key material: just the fact that the mitigation could
    // not run. Better a loud warning than a silently skipped wipe.
    console.warn('[sign-session] closeSession could not zero the retained key material');
  }
  // Ack so the caller can await the wipe before terminating this worker.
  post({ kind: 'sessionClosed', wiped });
}

// ---------- Serial task queue (concurrency 1, real) ----------

/**
 * Tail of the task chain. Every inbound message is appended, so message N+1
 * starts only after N has fully settled — including across `await` points,
 * which a plain `async` listener does NOT guarantee.
 */
let queueTail: Promise<void> = Promise.resolve();

/**
 * requestId of the document being handled right now, so the last-resort failure
 * handler below can NAME it. Reporting `'unknown'` was how a real worker error
 * became a dropped message on the bus and a generic 'timeout' for the user.
 */
let currentRequestId: string | null = null;

function enqueue(task: () => Promise<void> | void, requestIdForFailures?: string): void {
  queueTail = queueTail.then(task).catch((e) => {
    // Handlers already convert failures into `signError`/`sessionOpenError`
    // messages; anything reaching here would otherwise become an unhandled
    // rejection that silently kills the chain for every later message.
    post({
      kind: 'signError',
      requestId: requestIdForFailures ?? currentRequestId ?? UNKNOWN_REQUEST_ID,
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
      enqueue(async () => {
        currentRequestId = req.requestId;
        try {
          await handleSignNext(req);
        } finally {
          currentRequestId = null;
        }
      }, req.requestId);
      return;
    case 'closeSession':
      // NOT enqueued, on purpose: closeSession means the caller has given up on
      // this session (its per-document timeout fired, or the batch ended). The
      // key material must be zeroed NOW, not after the signature we already
      // abandoned finishes — that signature will fail with `session_not_open`,
      // which is exactly the desired outcome.
      handleCloseSession();
      return;
    default: {
      // A PWA routinely runs a stale bundle against a fresh worker (or the
      // reverse) after a deploy. Silence there is indistinguishable from a hang:
      // answer, and say which kind was not understood.
      const kind = (req as { kind?: unknown }).kind;
      console.warn(`[sign-session] unknown request kind: ${String(kind)}`);
      post({
        kind: 'protocolError',
        code: 'unknown_request_kind',
        message: `worker does not understand request kind ${String(kind)}`,
      });
      return;
    }
  }
});
