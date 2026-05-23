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

import { type ParsedPfx, SignerError, parsePfx } from '@firma-ec/signer';

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
    // Diagnostic guard (v0.7.35): if the buffer arrives empty/detached, forge's
    // MAC check fails and reports `pin_invalid` — indistinguishable from a real
    // wrong password to the user. Surface the true cause + the received length
    // so a mobile report ("contraseña no coincide" with the correct PIN) is not
    // misattributed to the password. A 0-byte buffer means a transfer/detach
    // bug upstream, never a wrong PIN.
    if (bytes.byteLength === 0) {
      ctx.postMessage({
        kind: 'error',
        code: 'empty_p12',
        message: 'p12 worker received 0 bytes (buffer detached before transfer)',
      } satisfies P12WorkerResponse);
      return;
    }
    const parsed = (await parsePfx(bytes, req.pin)) as ParsedPfxFull;
    // Transfer the PKCS#8 buffer back to the main thread when present, so it
    // doesn't get copied (saves memory for large keys).
    const transfer: Transferable[] = [];
    if (parsed.privateKeyPkcs8Der && parsed.privateKeyPkcs8Der.byteLength > 0) {
      transfer.push(parsed.privateKeyPkcs8Der);
    }
    ctx.postMessage({ kind: 'result', parsed } satisfies P12WorkerResponse, transfer);
  } catch (e) {
    const code = e instanceof SignerError ? e.code : 'unknown';
    let message = e instanceof Error ? e.message : String(e);
    // Non-sensitive PIN fingerprint for diagnosing a mobile-only `pin_invalid`
    // with a "correct" password. NEVER includes the characters — only shape
    // (length, whitespace, non-ASCII) so the user can read it safely from the
    // technical-detail panel. A trailing space or unexpected length points at
    // the on-screen keyboard mangling the input, not a wrong password.
    if (code === 'pin_invalid' || code === 'bad_pin') {
      const pin = typeof req.pin === 'string' ? req.pin : '';
      const trimmedDiffers = pin !== pin.trim();
      const hasInnerSpace = /\s/.test(pin.trim());
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ASCII-range check to detect non-ASCII chars in the PIN
      const allAscii = !/[^\x00-\x7f]/.test(pin);
      // Received .p12 byte size. forge reports a truncated/corrupted PKCS#12
      // (e.g. a file mangled in transit to the phone via chat/email) as a MAC
      // failure — indistinguishable from a wrong PIN. If `p12bytes` here is
      // smaller than the real file on disk, the upload was truncated, NOT the
      // password. A correct PIN that fails ONLY on mobile + a short byte count
      // = corrupted file, not a signer bug.
      const p12bytes = req.pfxBytes?.byteLength ?? 0;
      message += ` [pin shape: len=${pin.length}, trimmedDiffers=${trimmedDiffers}, innerSpace=${hasInnerSpace}, ascii=${allAscii}, p12bytes=${p12bytes}]`;
    }
    ctx.postMessage({ kind: 'error', code, message } satisfies P12WorkerResponse);
  }
});
