/**
 * p12.worker.ts — parse a .p12/.pfx off the main thread.
 *
 * forge.pkcs12FromAsn1 is CPU-bound and synchronous (the `async` wrapper on
 * parsePfx does NOT yield to the event loop). On mid-tier mobile with 3DES
 * legacy PFX (Ecuadorian ECI shape), this can freeze the UI for 1-3 seconds.
 * Moving it to a Worker keeps the main thread responsive — the "Descifrando…"
 * loader can animate, the PIN field can remain accessible, the cancel button
 * stays clickable.
 *
 * Single-shot security model (same as sign.worker.ts): caller terminates the
 * worker after every parse attempt (success or failure). PIN + PFX bytes do
 * NOT survive across calls. CryptoKey handles imported during parse are
 * destroyed automatically when the worker context is torn down.
 *
 * Protocol:
 *   in  : { kind: 'parsePfx', pfxBytes: ArrayBuffer, pin: string }
 *   out : { kind: 'result', parsed: ParsedPfxSerialisable }
 *       | { kind: 'error', code: string, message: string }
 *
 * `pfxBytes` is transferred (not copied). PIN travels as a string in the
 * payload; the main thread MUST avoid capturing it in any closure that
 * outlives the postMessage call.
 */

import { parsePfx, SignerError, type ParsedPfx } from '@firma-ec/signer';

/** parsePfx returns ParsedPfx augmented with the PKCS#8 DER private key buffer. */
type ParsedPfxFull = ParsedPfx & { privateKeyPkcs8Der: ArrayBuffer };

export interface P12WorkerParseRequest {
  kind: 'parsePfx';
  pfxBytes: ArrayBuffer;
  pin: string;
}

export type P12WorkerResponse =
  | { kind: 'result'; parsed: ParsedPfxFull }
  | { kind: 'error'; code: string; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', async (ev: MessageEvent<P12WorkerParseRequest>) => {
  const req = ev.data;

  if (!req || typeof req !== 'object' || req.kind !== 'parsePfx') {
    ctx.postMessage({
      kind: 'error',
      code: 'bad_request',
      message: 'Unrecognised p12 worker request',
    } satisfies P12WorkerResponse);
    return;
  }

  try {
    const bytes = new Uint8Array(req.pfxBytes);
    const parsed = (await parsePfx(bytes, req.pin)) as ParsedPfxFull;
    // Transfer the PKCS#8 buffer back to the main thread when present, so it
    // doesn't get copied (saves memory for large keys).
    const transfer: Transferable[] = [];
    if (parsed.privateKeyPkcs8Der && parsed.privateKeyPkcs8Der.byteLength > 0) {
      transfer.push(parsed.privateKeyPkcs8Der);
    }
    ctx.postMessage(
      { kind: 'result', parsed } satisfies P12WorkerResponse,
      transfer,
    );
  } catch (e) {
    const code = e instanceof SignerError ? e.code : 'unknown';
    const message = e instanceof Error ? e.message : String(e);
    ctx.postMessage({ kind: 'error', code, message } satisfies P12WorkerResponse);
  }
});
