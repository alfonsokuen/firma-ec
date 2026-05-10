/**
 * p12-bus.ts — main-thread helper for the .p12 parse worker.
 *
 * Single-shot per call: spawns a fresh Worker, posts the parse request,
 * resolves with the parsed PFX (or rejects), then terminates the worker.
 * Preserves the same single-shot security model used by sign-bus.ts.
 */

import type { ParsedPfx } from '@firma-ec/signer';
import type { P12WorkerResponse } from './p12.worker';

type ParsedPfxFull = ParsedPfx & { privateKeyPkcs8Der: ArrayBuffer };

export class P12WorkerError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'P12WorkerError';
  }
}

export interface ParsePfxInWorkerOpts {
  /** Optional AbortSignal — calling `abort()` terminates the worker and rejects. */
  signal?: AbortSignal;
  /** Worker factory override (testing). Default = new Worker(import.meta.url). */
  workerFactory?: () => Worker;
}

function defaultFactory(): Worker {
  // Vite bundles the worker module via `?worker` import. Inline import here
  // avoids a circular dependency with the worker file at build time.
  return new Worker(new URL('./p12.worker.ts', import.meta.url), {
    type: 'module',
    name: 'firma-ec-p12',
  });
}

/**
 * Parse a PFX off the main thread.
 *
 * The `pfxBytes` ArrayBuffer is transferred (detached on the caller side).
 * Caller should pass a defensive copy if the bytes are needed afterwards.
 */
export function parsePfxInWorker(
  pfxBytes: ArrayBuffer,
  pin: string,
  opts: ParsePfxInWorkerOpts = {},
): Promise<ParsedPfxFull> {
  return new Promise<ParsedPfxFull>((resolve, reject) => {
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
      reject(new P12WorkerError('aborted', 'p12 parse aborted'));
    };

    if (opts.signal) {
      if (opts.signal.aborted) {
        abortHandler();
        return;
      }
      opts.signal.addEventListener('abort', abortHandler, { once: true });
    }

    worker.addEventListener('message', (ev: MessageEvent<P12WorkerResponse>) => {
      const res = ev.data;
      if (settled) return;
      if (res.kind === 'result') {
        cleanup();
        resolve(res.parsed);
      } else if (res.kind === 'error') {
        cleanup();
        reject(new P12WorkerError(res.code, res.message));
      }
    });

    worker.addEventListener('error', (ev) => {
      if (settled) return;
      cleanup();
      reject(new P12WorkerError('worker_error', ev.message || 'p12 worker crashed'));
    });

    worker.postMessage({ kind: 'parsePfx', pfxBytes, pin }, [pfxBytes]);
  });
}
