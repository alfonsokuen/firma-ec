/**
 * sign.worker.ts — isolated Web Worker that runs PAdES-B-B signing off the main thread.
 *
 * Security model: this worker is single-shot. The `sign-bus.runSign` helper terminates
 * the worker after every signing attempt (success OR failure). Rationale:
 *   - Mitigates side-channel leakage between unrelated PDFs / private keys (separate
 *     WASM/JS heaps; CryptoKey objects + PKCS#8 buffers + decrypted PIN do NOT survive
 *     across signing operations).
 *   - The CryptoKey handle imported inside this worker is destroyed automatically
 *     when the global context is torn down on `worker.terminate()`. Same for the
 *     PFX bytes, the PDF buffer, and any intermediate hashes.
 *   - Defense in depth — even though @firma-ec/signer doesn't intentionally retain
 *     secrets, a fresh heap per call is the strongest in-browser guarantee.
 *
 * Protocol (see ./sign-bus.ts for typed contracts):
 *   in  : { kind: 'sign', pdf: ArrayBuffer, p12: ArrayBuffer, pin: string,
 *           opts: { reason?, location?, contactInfo?, visibleSig?, signingTime?, sigAlg? } }
 *   out : { kind: 'progress', stage: 'parse_p12'|'parse_pdf'|'compute_hash'|'sign'|'embed'|'done' }
 *       | { kind: 'result', signedPdf: ArrayBuffer }
 *       | { kind: 'error', code: string, message: string }
 *
 * Both `pdf` and `p12` are transferred (not copied) — caller MUST treat input
 * ArrayBuffers as detached after posting. See `runSign` which handles this correctly.
 *
 * The PIN travels in the request payload string. The main thread does NOT retain a
 * reference to the PIN past `postMessage` (see `runSign` — pin is a function arg, not
 * captured by any closure that outlives the call).
 */

import {
  type LtvMeta,
  type PadesSignOptions,
  type ParsedPfx,
  SignerError,
  type TimestampMeta,
  addIncrementalSignature,
  detectSignatures,
  ltvNotApplicable,
  parsePfx,
  signPdfPades,
} from '@firma-ec/signer';
import type { SignWorkerRequest, SignWorkerResponse } from './sign-bus';

/** parsePfx actually returns ParsedPfx augmented with the PKCS#8 DER private key buffer. */
type ParsedPfxFull = ParsedPfx & { privateKeyPkcs8Der: ArrayBuffer };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: SignWorkerResponse, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    ctx.postMessage(msg, transfer);
  } else {
    ctx.postMessage(msg);
  }
}

ctx.addEventListener('message', async (ev: MessageEvent<SignWorkerRequest>) => {
  const req = ev.data;

  if (!req || typeof req !== 'object' || req.kind !== 'sign') {
    post({
      kind: 'error',
      code: 'bad_request',
      message: 'sign.worker received an unrecognised message',
    });
    return;
  }

  try {
    // 1. Parse PKCS#12 (validates PIN, extracts cert + private key)
    post({ kind: 'progress', stage: 'parse_p12' });
    const parsedPfx = (await parsePfx(new Uint8Array(req.p12), req.pin)) as ParsedPfxFull;

    // 2. Parse the input PDF + detect prior signatures (single vs multi)
    post({ kind: 'progress', stage: 'parse_pdf' });
    const pdfBytes = new Uint8Array(req.pdf);
    const prior = await detectSignatures(pdfBytes);

    // F6 — TSA settings (default-on per spec; main thread reads from settings store).
    const timestampEnabled = req.timestampEnabled !== false;
    const tsaUrl = req.tsaUrl;
    const tsaTimeoutMs = req.tsaTimeoutMs;

    // F7 — LTV settings (default-on; main thread forwards from settings store).
    // ltvEnabled=false → skip both B-LT and B-LTA. ltvArchiveEnabled=false →
    // do B-LT only (no document timestamp).
    const ltvEnabled = req.ltvEnabled !== false;
    const ltvArchiveEnabled = ltvEnabled && req.ltvArchiveEnabled !== false;
    const ltvTimeoutMs = req.ltvTimeoutMs;
    const ocspUrlOverride = req.ocspUrl && req.ocspUrl.length > 0 ? req.ocspUrl : undefined;

    // 3. Build PadesSignOptions from the request opts.
    //    visibleSig requires `signerCN`; fill it from the parsed cert (the wire
    //    contract intentionally omits it so the main thread doesn't have to know
    //    the CN before parsing the PFX).
    // F1 — captures the outcome of the intermediate-chain resolution
    // (bundle + AIA fallback). Wired via padesOpts.onChainResolution so it's
    // populated identically whether signing goes through signPdfPades
    // (single sig) or addIncrementalSignature (multi-firma) below — both
    // consume the SAME PadesSignOptions object.
    let chainComplete = true;
    let missingIssuerDn: string | undefined;
    const onChainResolution = (r: { complete: boolean; missingIssuerDn?: string }): void => {
      chainComplete = r.complete;
      missingIssuerDn = r.missingIssuerDn;
    };

    let timestampReceived = false;
    const onTimestampResult = (): void => {
      // F6 §Task 14 — emit progress when the TSA exchange completes (the signer
      // calls this hook between sending the TSP request and assembling CMS DER).
      // We emit a single 'request_timestamp' marker on first invocation only.
      if (timestampReceived) return;
      timestampReceived = true;
      post({ kind: 'progress', stage: 'request_timestamp' });
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
        ? {
            visibleSig: {
              ...req.opts.visibleSig,
              signerCN: parsedPfx.signingCert.subjectCN,
              signerId: parsedPfx.signingCert.holderCedula,
            },
          }
        : {}),
      timestamp: timestampEnabled,
      ...(tsaUrl !== undefined ? { tsaUrl } : {}),
      ...(tsaTimeoutMs !== undefined ? { tsaTimeoutMs } : {}),
      onTimestampResult,
      // 2026-08-05 HIGH fix (independent Fable + opus review, both,
      // confirmed): this used to stay at the signer's default (enabled, no
      // deadline) — the AIA walk (up to 8 hops) had no share of THIS
      // document's network budget, so a hung AIA responder could consume
      // more time than `computeSignTimeoutMs` allows and get the whole
      // signature discarded by the external timer in `runSign` (sign-bus.ts)
      // instead of degrading to a reported "chain incomplete". `deadlineAt`
      // is computed HERE (not by the caller) for the same reason as
      // sign-session.worker.ts's identical pattern: it must cover network
      // time only, not any time spent before this worker started running.
      ...(req.aiaTimeoutMs !== undefined || req.aiaBudgetMs !== undefined
        ? {
            aiaFallback: {
              ...(req.aiaTimeoutMs !== undefined ? { timeoutMs: req.aiaTimeoutMs } : {}),
              ...(req.aiaBudgetMs !== undefined
                ? { deadlineAt: Date.now() + req.aiaBudgetMs }
                : {}),
            },
          }
        : {}),
      onChainResolution,
      // F7 — long-term validation.
      ltv: {
        longTerm: ltvEnabled,
        longTermArchive: ltvArchiveEnabled,
        ...(ltvTimeoutMs !== undefined ? { ocspTimeoutMs: ltvTimeoutMs, ltvTimeoutMs } : {}),
        ...(ocspUrlOverride ? { ocspUrl: ocspUrlOverride } : {}),
        // Fire-and-forget progress: signer calls onLtvResult once per stage.
        // We surface coarse stages so the spinner copy can change ("Solicitando
        // OCSP…" / "Construyendo DSS…" / "Sello de archivo…"). Signer F7 T17
        // schedules onLtvResult after each tier; we map onto the progress
        // stage we *just entered* heuristically.
        onLtvResult: (): void => {
          // No-op: real per-stage hooks would require a richer callback shape
          // on the signer side. Coarse markers below are emitted from the
          // worker directly between major signer calls.
        },
      },
    };

    // 4. Compute hash + 5. Sign (signer package wraps both internally; we emit
    //    coarse progress markers so the UI can render a meaningful spinner).
    post({ kind: 'progress', stage: 'compute_hash' });
    post({ kind: 'progress', stage: 'sign' });

    let signed: Uint8Array;
    let timestamp: TimestampMeta;
    let ltv: LtvMeta;
    if (prior.length > 0) {
      // 6. Multi-firma: incremental update (preserves prior signatures byte-for-byte).
      //    F6 — incremental path is B-B only (signer pins timestamp:false there).
      //    F7 — LT/LTA only makes sense for the OUTERMOST B-T signature on a
      //    document; attaching a DSS dict to an incremental B-B inner signature
      //    has no normative benefit and would mislead verifiers. Pin ltv:false
      //    here and surface `ltv_skipped_multifirma` so the UI can explain why.
      //    F6.2 — distinguish "user turned TSA off" from "multi-firma forces B-B"
      //    so the UI can render an informational pill (not a warning) and the
      //    user understands timestamp is silently absent by design.
      signed = await addIncrementalSignature(pdfBytes, parsedPfx, padesOpts);
      timestamp = {
        ok: false,
        reason: timestampEnabled ? 'multifirma_path' : 'user_disabled',
      };
      ltv = ltvNotApplicable('B-B');
    } else {
      // 6. Single signature: full PAdES-B-B (or B-T when timestamp opt enabled).
      //    F6.2 — emit the `request_timestamp` stage BEFORE entering the signer
      //    so the UI shows "Solicitando sello de tiempo…" while the TSA fetch
      //    is in flight (signer still calls `onTimestampResult` post-fetch as
      //    a no-op since `timestampReceived` is already true).
      if (timestampEnabled) {
        timestampReceived = true;
        post({ kind: 'progress', stage: 'request_timestamp' });
      }
      // F7 — coarse LTV progress markers. Signer F7 T17 runs:
      //   B-T → fetch OCSP → fetch CRL (fallback) → build DSS → doc TSA.
      // We emit stages here as best-effort signals; the actual fetch happens
      // inside signPdfPades. Posting before-call lets the spinner copy change
      // while the user waits.
      if (ltvEnabled) {
        post({ kind: 'progress', stage: 'fetch_ocsp' });
      }
      const sres = await signPdfPades(pdfBytes, parsedPfx, padesOpts);
      signed = sres.signedPdf;
      timestamp = sres.timestamp;
      ltv = sres.ltv;
      // Emit terminal LTV stage based on what tier actually landed.
      if (ltv.archiveAchieved) {
        post({ kind: 'progress', stage: 'document_timestamp' });
      } else if (ltv.longTermAchieved) {
        post({ kind: 'progress', stage: 'build_dss' });
      }
      // F6.2 — normalise legacy 'disabled' reason coming from signer when the
      // caller explicitly opted out, so DownloadResult.svelte can rely on the
      // narrower union without extra fallbacks.
      if (!timestamp.ok && timestamp.reason === 'disabled' && !timestampEnabled) {
        timestamp = { ...timestamp, reason: 'user_disabled' };
      }
    }

    post({ kind: 'progress', stage: 'embed' });

    // Transfer the signed PDF back as ArrayBuffer. Always slice() into a fresh
    // ArrayBuffer — guarantees we never hand out a SharedArrayBuffer (which is
    // not transferable) and detaches any view aliasing the original buffer.
    const out: ArrayBuffer = signed.slice().buffer as ArrayBuffer;

    post({ kind: 'progress', stage: 'done' });
    post(
      {
        kind: 'result',
        signedPdf: out,
        timestamp,
        ltv,
        chainComplete,
        ...(missingIssuerDn !== undefined ? { missingIssuerDn } : {}),
      },
      [out],
    );
  } catch (e) {
    if (e instanceof SignerError) {
      // Passthrough: same code string the package raised.
      post({ kind: 'error', code: e.code, message: e.message });
      return;
    }
    const err = e as Error & { code?: string };
    post({
      kind: 'error',
      code: err.code ?? 'unknown',
      message: err.message ?? String(e),
    });
  }
});
