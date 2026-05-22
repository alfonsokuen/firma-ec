/**
 * cert-bus.ts — main-thread helper for the certificate-validation worker.
 *
 * Single-shot per call: spawns a fresh Worker, posts the checkCert request,
 * resolves with the CertCheckResult (or rejects), then terminates the worker.
 * Preserves the same single-shot security model used by p12-bus.ts — the PIN
 * + PFX bytes never survive across calls and the private key never leaves the
 * worker.
 */

import type { CertCheckResult } from '@firma-ec/verifier';
import type { CertWorkerResponse } from './cert.worker';

export class CertWorkerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CertWorkerError';
  }
}

export interface CheckCertInWorkerOpts {
  /** Optional AbortSignal — calling `abort()` terminates the worker and rejects. */
  signal?: AbortSignal;
  /** Worker factory override (testing). Default = new Worker(import.meta.url). */
  workerFactory?: () => Worker;
}

function defaultFactory(): Worker {
  return new Worker(new URL('./cert.worker.ts', import.meta.url), {
    type: 'module',
    name: 'firma-ec-cert',
  });
}

/**
 * Validate a PFX certificate off the main thread.
 *
 * The `pfxBytes` ArrayBuffer is transferred (detached on the caller side).
 * Caller should pass a defensive copy if the bytes are needed afterwards.
 */
export function checkCertInWorker(
  pfxBytes: ArrayBuffer,
  pin: string,
  opts: CheckCertInWorkerOpts = {},
): Promise<CertCheckResult> {
  return new Promise<CertCheckResult>((resolve, reject) => {
    const factory = opts.workerFactory ?? defaultFactory;
    const worker = factory();
    let settled = false;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      try {
        worker.terminate();
      } catch {
        /* noop */
      }
      if (opts.signal && abortHandler) {
        opts.signal.removeEventListener('abort', abortHandler);
      }
    };

    const abortHandler = (): void => {
      cleanup();
      reject(new CertWorkerError('aborted', 'cert validation aborted'));
    };

    if (opts.signal) {
      if (opts.signal.aborted) {
        abortHandler();
        return;
      }
      opts.signal.addEventListener('abort', abortHandler, { once: true });
    }

    worker.addEventListener('message', (ev: MessageEvent<CertWorkerResponse>) => {
      const res = ev.data;
      if (settled) return;
      if (res.kind === 'result') {
        cleanup();
        resolve(res.result);
      } else if (res.kind === 'error') {
        cleanup();
        reject(new CertWorkerError(res.code, res.message));
      }
    });

    worker.addEventListener('error', (ev) => {
      if (settled) return;
      cleanup();
      reject(new CertWorkerError('worker_error', ev.message || 'cert worker crashed'));
    });

    worker.postMessage({ kind: 'checkCert', pfxBytes, pin }, [pfxBytes]);
  });
}
