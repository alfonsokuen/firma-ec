/**
 * How a verification actually gets executed.
 *
 * Two implementations, and the difference is not cosmetic:
 *
 * - `InProcessRunner` runs the engine on the main thread. Its deadline can only
 *   stop WAITING for the result; it cannot stop the work. Measured on a hostile
 *   document: a 60s deadline answered at 176s because a timer cannot interrupt
 *   synchronous JavaScript. Acceptable only behind the admission gate, in dev
 *   and in tests.
 *
 * - `WorkerRunner` runs it on a pooled worker thread and, on timeout, calls
 *   `terminate()`. That is the only variant where a 504 means the CPU came
 *   back. The killed worker is replaced, which is the price of cancellation.
 *
 * The pool is persistent on purpose: spawning a worker per request would re-
 * parse a 3MB bundle every time.
 */
import { Worker } from 'node:worker_threads';
import { verifyAllSignatures } from '@firma-ec/verifier';
import { VerifyApiError } from '../lib/errors.js';
import type { VerifyWorkerMessage } from '../worker/verifyWorker.js';

export interface VerifyRunner {
  run(pdf: Buffer, fetchOcsp: boolean, timeoutMs: number): Promise<unknown>;
  /** Whether the runner is able to execute at all. Surfaced by /healthz. */
  isReady(): boolean;
  close(): Promise<void>;
}

export class InProcessRunner implements VerifyRunner {
  async run(pdf: Buffer, fetchOcsp: boolean, timeoutMs: number): Promise<unknown> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new VerifyApiError('verify_timeout', `verification exceeded ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([
        verifyAllSignatures(new Uint8Array(pdf), { fetchOcsp }),
        deadline,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  isReady(): boolean {
    return true;
  }

  async close(): Promise<void> {
    // Nothing to release.
  }
}

interface PooledWorker {
  worker: Worker;
  busy: boolean;
}

export class WorkerRunner implements VerifyRunner {
  private readonly pool: PooledWorker[] = [];
  private readonly waiting: ((w: PooledWorker) => void)[] = [];
  private closed = false;

  constructor(
    private readonly workerPath: URL,
    size: number,
  ) {
    for (let i = 0; i < size; i += 1) this.pool.push(this.spawn());
  }

  private spawn(): PooledWorker {
    const worker = new Worker(this.workerPath);
    // A worker that dies on its own (OOM, an engine crash) must not leave a
    // permanently "busy" slot behind, silently shrinking the pool to zero.
    worker.on('exit', () => {
      if (this.closed) return;
      const idx = this.pool.findIndex((p) => p.worker === worker);
      if (idx !== -1) this.pool.splice(idx, 1, this.spawn());
    });
    worker.unref();
    return { worker, busy: false };
  }

  private async acquire(): Promise<PooledWorker> {
    const free = this.pool.find((p) => !p.busy);
    if (free !== undefined) {
      free.busy = true;
      return free;
    }
    return new Promise<PooledWorker>((resolve) => {
      this.waiting.push((w) => {
        w.busy = true;
        resolve(w);
      });
    });
  }

  private release(entry: PooledWorker): void {
    entry.busy = false;
    const next = this.waiting.shift();
    if (next !== undefined) next(entry);
  }

  /** Replace a worker we had to kill, and hand the slot to whoever is waiting. */
  private replace(entry: PooledWorker): void {
    const idx = this.pool.indexOf(entry);
    const fresh = this.spawn();
    if (idx === -1) this.pool.push(fresh);
    else this.pool.splice(idx, 1, fresh);
    const next = this.waiting.shift();
    if (next !== undefined) next(fresh);
  }

  async run(pdf: Buffer, fetchOcsp: boolean, timeoutMs: number): Promise<unknown> {
    if (this.closed) throw new VerifyApiError('internal', 'runner is closed');
    const entry = await this.acquire();

    // Copy into a standalone ArrayBuffer so it can be TRANSFERRED rather than
    // structured-cloned: a 20MB clone would double the peak for every request.
    // The copy (not Fastify's own buffer) is what gets detached, so nothing
    // downstream is left holding a neutered buffer.
    const transferable = new ArrayBuffer(pdf.byteLength);
    new Uint8Array(transferable).set(pdf);

    return await new Promise<unknown>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void, killed: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        entry.worker.off('message', onMessage);
        entry.worker.off('error', onError);
        if (killed) void entry.worker.terminate().then(() => this.replace(entry));
        else this.release(entry);
        fn();
      };

      const onMessage = (msg: VerifyWorkerMessage): void => {
        finish(() => {
          if (msg.ok) resolve(msg.result);
          else reject(new VerifyApiError('internal', msg.message));
        }, false);
      };
      const onError = (err: Error): void => {
        // The worker is in an unknown state; do not hand it another job.
        finish(() => reject(new VerifyApiError('internal', err.message)), true);
      };
      const timer = setTimeout(() => {
        // This is the whole point: terminate() reclaims the CPU. Without it a
        // timeout is just us looking away while the work continues.
        finish(
          () =>
            reject(new VerifyApiError('verify_timeout', `verification exceeded ${timeoutMs}ms`)),
          true,
        );
      }, timeoutMs);

      entry.worker.on('message', onMessage);
      entry.worker.on('error', onError);
      entry.worker.postMessage({ pdf: transferable, fetchOcsp }, [transferable]);
    });
  }

  isReady(): boolean {
    return !this.closed && this.pool.length > 0;
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(this.pool.map((p) => p.worker.terminate()));
    this.pool.length = 0;
  }
}
