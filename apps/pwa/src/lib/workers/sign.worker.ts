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
  parsePfx,
  signPdfPades,
  addIncrementalSignature,
  detectSignatures,
  SignerError,
  type PadesSignOptions,
  type ParsedPfx,
  type TimestampMeta,
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

    // 3. Build PadesSignOptions from the request opts.
    //    visibleSig requires `signerCN`; fill it from the parsed cert (the wire
    //    contract intentionally omits it so the main thread doesn't have to know
    //    the CN before parsing the PFX).
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
      ...(req.opts?.signingTime !== undefined ? { signingTime: new Date(req.opts.signingTime) } : {}),
      ...(req.opts?.sigAlg !== undefined ? { sigAlg: req.opts.sigAlg } : {}),
      ...(req.opts?.visibleSig !== undefined
        ? {
            visibleSig: {
              ...req.opts.visibleSig,
              signerCN: parsedPfx.signingCert.subjectCN,
            },
          }
        : {}),
      timestamp: timestampEnabled,
      ...(tsaUrl !== undefined ? { tsaUrl } : {}),
      ...(tsaTimeoutMs !== undefined ? { tsaTimeoutMs } : {}),
      onTimestampResult,
    };

    // 4. Compute hash + 5. Sign (signer package wraps both internally; we emit
    //    coarse progress markers so the UI can render a meaningful spinner).
    post({ kind: 'progress', stage: 'compute_hash' });
    post({ kind: 'progress', stage: 'sign' });

    let signed: Uint8Array;
    let timestamp: TimestampMeta;
    if (prior.length > 0) {
      // 6. Multi-firma: incremental update (preserves prior signatures byte-for-byte).
      //    F6 — incremental path is B-B only (signer pins timestamp:false there).
      signed = await addIncrementalSignature(pdfBytes, parsedPfx, padesOpts);
      timestamp = { ok: false, reason: 'disabled' };
    } else {
      // 6. Single signature: full PAdES-B-B (or B-T when timestamp opt enabled).
      const sres = await signPdfPades(pdfBytes, parsedPfx, padesOpts);
      signed = sres.signedPdf;
      timestamp = sres.timestamp;
    }

    post({ kind: 'progress', stage: 'embed' });

    // Transfer the signed PDF back as ArrayBuffer. Always slice() into a fresh
    // ArrayBuffer — guarantees we never hand out a SharedArrayBuffer (which is
    // not transferable) and detaches any view aliasing the original buffer.
    const out: ArrayBuffer = signed.slice().buffer as ArrayBuffer;

    post({ kind: 'progress', stage: 'done' });
    post({ kind: 'result', signedPdf: out, timestamp }, [out]);
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
