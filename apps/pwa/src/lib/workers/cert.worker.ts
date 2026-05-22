/**
 * cert.worker.ts — validate a .p12/.pfx certificate off the main thread.
 *
 * Powers the "Validar Certificado" page: parse the PFX (CPU-bound forge work,
 * same as p12.worker.ts), extract the leaf + intermediates as DER, then run
 * the verifier's `checkCertificate` chain check against the ARCOTEL TSL-EC.
 *
 * Single-shot security model (same as p12.worker.ts / sign.worker.ts): caller
 * terminates the worker after every call. The PIN + PFX bytes do NOT survive
 * across calls, and the private key NEVER crosses back over postMessage — only
 * the public CertCheckResult is returned.
 *
 * Protocol:
 *   in  : { kind: 'checkCert', pfxBytes: ArrayBuffer, pin: string }
 *   out : { kind: 'result', result: CertCheckResult }
 *       | { kind: 'error', code: string, message: string }
 */

import { SignerError, parsePfx } from '@firma-ec/signer';
import { type CertCheckResult, checkCertificate } from '@firma-ec/verifier';

export interface CertWorkerCheckRequest {
  kind: 'checkCert';
  pfxBytes: ArrayBuffer;
  pin: string;
}

export type CertWorkerResponse =
  | { kind: 'result'; result: CertCheckResult }
  | { kind: 'error'; code: string; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', async (ev: MessageEvent<CertWorkerCheckRequest>) => {
  const req = ev.data;

  if (!req || typeof req !== 'object' || req.kind !== 'checkCert') {
    ctx.postMessage({
      kind: 'error',
      code: 'bad_request',
      message: 'Unrecognised cert worker request',
    } satisfies CertWorkerResponse);
    return;
  }

  try {
    const bytes = new Uint8Array(req.pfxBytes);
    // Diagnostic guard (mirrors p12.worker.ts): a 0-byte buffer means a
    // transfer/detach bug upstream, never a wrong PIN.
    if (bytes.byteLength === 0) {
      ctx.postMessage({
        kind: 'error',
        code: 'empty_p12',
        message: 'cert worker received 0 bytes (buffer detached before transfer)',
      } satisfies CertWorkerResponse);
      return;
    }

    const parsed = await parsePfx(bytes, req.pin);
    // NEVER post the private key back — only the public certs are used here.
    const result = await checkCertificate(
      parsed.signingCert.der,
      parsed.intermediates.map((i) => i.der),
    );
    ctx.postMessage({ kind: 'result', result } satisfies CertWorkerResponse);
  } catch (e) {
    const code = e instanceof SignerError ? e.code : 'unknown';
    const message = e instanceof Error ? e.message : String(e);
    ctx.postMessage({ kind: 'error', code, message } satisfies CertWorkerResponse);
  }
});
