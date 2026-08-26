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
 * The pool is persistent on purpose: spawning a worker per request would
 * re-parse a multi-megabyte bundle every time.
 *
 * ## Failure handling, and why it is this elaborate
 *
 * An independent review broke three earlier attempts here, so the invariants
 * are spelled out:
 *
 *  1. **Exactly one replacement per death.** The first version replaced a
 *     worker from BOTH the `exit` handler and the terminate continuation, so
 *     every timeout permanently grew the pool (measured: 2 -> 3 -> 4 -> 5 after
 *     three timeouts). `VERIFY_WORKERS` is the only documented ceiling on
 *     simultaneous heavy work, so a pool that grows on its own quietly removes
 *     the ceiling. Replacement now happens in one place, keyed on the entry.
 *  2. **A worker that dies outside a request must not kill the process.** The
 *     `error` listener used to exist only during `run()`, so a worker that
 *     failed to boot emitted an unhandled 'error' and took the process down.
 *     Listeners are now permanent, installed at spawn.
 *  3. **Respawning needs a brake.** With a worker that cannot start (a bad or
 *     missing bundle), unconditional replacement span 379 workers in 3 seconds.
 *     Consecutive early deaths back off, and `isReady()` reports the truth so
 *     the health probe goes red instead of watching the box burn.
 *
 * And two liveness rules: a death during a request rejects THAT request
 * immediately (rather than letting it wait out a 60s deadline and report a
 * misleading timeout), and waiting for a free worker has its own deadline.
 */
import { Worker } from 'node:worker_threads';
import { verifyAllSignatures } from '@firma-ec/verifier';
import { VerifyApiError } from '../lib/errors.js';
import type { VerifyWorkerMessage } from '../worker/verifyWorker.js';

export interface VerifyRunner {
  run(pdf: Buffer, fetchOcsp: boolean, timeoutMs: number): Promise<unknown>;
  /** Whether the runner can actually execute. Surfaced by /healthz. */
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

/** Logging seam: the runner has no Fastify request to log through. */
export type RunnerLogger = (
  level: 'warn' | 'error',
  event: string,
  detail: Record<string, unknown>,
) => void;

interface Job {
  reject(err: Error): void;
  settled: boolean;
}

interface PooledWorker {
  worker: Worker;
  online: boolean;
  busy: boolean;
  /** True once this entry has been replaced or retired; it never comes back. */
  retired: boolean;
  spawnedAt: number;
  job?: Job | undefined;
}

export interface WorkerRunnerOpts {
  /** Max time a request may wait for a free worker before 503. */
  queueTimeoutMs?: number;
  /** Max requests waiting for a worker; beyond this we shed load immediately. */
  maxQueue?: number;
  log?: RunnerLogger;
}

const DEFAULT_QUEUE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_QUEUE = 32;
/** A worker dying sooner than this is treated as a boot failure, not a crash. */
const EARLY_DEATH_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;

export class WorkerRunner implements VerifyRunner {
  private readonly pool: PooledWorker[] = [];
  private readonly waiting: { resolve(w: PooledWorker): void; reject(e: Error): void }[] = [];
  private closed = false;
  private consecutiveEarlyDeaths = 0;
  private readonly queueTimeoutMs: number;
  private readonly maxQueue: number;
  private readonly log: RunnerLogger;

  constructor(
    private readonly workerPath: URL,
    size: number,
    opts: WorkerRunnerOpts = {},
  ) {
    this.queueTimeoutMs = opts.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS;
    this.maxQueue = opts.maxQueue ?? DEFAULT_MAX_QUEUE;
    this.log = opts.log ?? (() => {});
    for (let i = 0; i < size; i += 1) this.pool.push(this.spawn());
  }

  private spawn(): PooledWorker {
    const entry: PooledWorker = {
      worker: new Worker(this.workerPath),
      online: false,
      busy: false,
      retired: false,
      spawnedAt: Date.now(),
    };

    entry.worker.on('online', () => {
      entry.online = true;
      this.consecutiveEarlyDeaths = 0;
    });
    // Permanent listeners: a worker can fail while idle, and an unhandled
    // 'error' event on a Worker takes the whole process down.
    entry.worker.on('error', (err) =>
      this.onDeath(entry, 'worker_error', { message: err.message }),
    );
    entry.worker.on('messageerror', (err) =>
      this.onDeath(entry, 'worker_messageerror', { message: err.message }),
    );
    entry.worker.on('exit', (code) => this.onDeath(entry, 'worker_exit', { exitCode: code }));

    // Do not hold the event loop open just because idle workers exist.
    entry.worker.unref();
    return entry;
  }

  /**
   * A worker died. Fail its in-flight request NOW — waiting out the verify
   * deadline would report `verify_timeout`, which is a lie: the document was
   * not slow, the worker crashed.
   */
  private onDeath(entry: PooledWorker, event: string, detail: Record<string, unknown>): void {
    const job = entry.job;
    entry.job = undefined;
    this.log('error', event, { ...detail, poolSize: this.pool.length });

    // Retire BEFORE rejecting. Rejecting runs the job's `settle`, which would
    // otherwise release this entry back into the pool — handing a dead worker
    // to whoever is waiting next.
    this.retire(entry);

    // Do NOT set `settled` here: `job.reject` routes through `settle`, which
    // returns early if the flag is already set. Setting it first made the
    // rejection a no-op and the request hung until its deadline — exactly the
    // bogus `verify_timeout` this is meant to prevent.
    if (job !== undefined && !job.settled) {
      job.reject(new VerifyApiError('worker_died', 'the verification worker stopped'));
    }
  }

  /** Remove an entry and schedule exactly one replacement. Idempotent. */
  private retire(entry: PooledWorker): void {
    if (entry.retired) return; // The invariant: one replacement per death.
    entry.retired = true;
    if (this.closed) return;

    const idx = this.pool.indexOf(entry);
    if (idx !== -1) this.pool.splice(idx, 1);

    const diedEarly = Date.now() - entry.spawnedAt < EARLY_DEATH_MS;
    if (diedEarly) this.consecutiveEarlyDeaths += 1;

    const backoff = diedEarly
      ? Math.min(MAX_BACKOFF_MS, 100 * 2 ** Math.min(this.consecutiveEarlyDeaths, 8))
      : 0;

    if (backoff === 0) {
      this.addFresh();
      return;
    }
    // Back off: a worker that cannot boot would otherwise be respawned in a hot
    // loop (measured: 379 workers in 3 seconds) while /healthz stayed green.
    this.log('warn', 'worker_respawn_backoff', {
      backoffMs: backoff,
      consecutiveEarlyDeaths: this.consecutiveEarlyDeaths,
    });
    const timer = setTimeout(() => {
      if (!this.closed) this.addFresh();
    }, backoff);
    timer.unref();
  }

  private addFresh(): void {
    const fresh = this.spawn();
    this.pool.push(fresh);
    const next = this.waiting.shift();
    if (next !== undefined) {
      fresh.busy = true;
      next.resolve(fresh);
    }
  }

  private async acquire(): Promise<PooledWorker> {
    const free = this.pool.find((p) => !p.busy && !p.retired);
    if (free !== undefined) {
      free.busy = true;
      return free;
    }
    if (this.waiting.length >= this.maxQueue) {
      throw new VerifyApiError('service_busy', 'too many verifications queued');
    }
    return await new Promise<PooledWorker>((resolve, reject) => {
      const waiter = { resolve, reject };
      this.waiting.push(waiter);
      // Waiting needs its own deadline: otherwise a stalled pool leaves clients
      // hanging with no error at all.
      const timer = setTimeout(() => {
        const idx = this.waiting.indexOf(waiter);
        if (idx !== -1) this.waiting.splice(idx, 1);
        reject(new VerifyApiError('service_busy', 'timed out waiting for a verification worker'));
      }, this.queueTimeoutMs);
      timer.unref();
    });
  }

  private release(entry: PooledWorker): void {
    if (entry.retired) return;
    entry.busy = false;
    const next = this.waiting.shift();
    if (next !== undefined) {
      entry.busy = true;
      next.resolve(entry);
    }
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
      let timer: NodeJS.Timeout | undefined;

      const onMessage = (msg: VerifyWorkerMessage): void => {
        settle(() => {
          if (msg.ok) resolve(msg.result);
          else reject(new VerifyApiError('internal', msg.message));
        }, false);
      };

      /** Single exit path, so bookkeeping cannot diverge between outcomes. */
      const settle = (fn: () => void, kill: boolean): void => {
        if (job.settled) return;
        job.settled = true;
        if (timer !== undefined) clearTimeout(timer);
        entry.worker.off('message', onMessage);
        entry.job = undefined;
        if (kill) {
          // terminate() fires 'exit', which retires the entry and schedules the
          // single replacement. Nothing else may replace it.
          void entry.worker.terminate().catch((err: unknown) => {
            this.log('error', 'worker_terminate_failed', { message: String(err) });
          });
        } else {
          this.release(entry);
        }
        fn();
      };

      // `onDeath` rejects through this, so a crash surfaces as a crash instead
      // of waiting out the verify deadline and reporting a bogus timeout.
      const job: Job = {
        settled: false,
        reject: (err: Error) => settle(() => reject(err), false),
      };
      entry.job = job;

      timer = setTimeout(() => {
        // This is the whole point: terminate() reclaims the CPU. Without it a
        // timeout is just us looking away while the work continues.
        settle(
          () =>
            reject(new VerifyApiError('verify_timeout', `verification exceeded ${timeoutMs}ms`)),
          true,
        );
      }, timeoutMs);

      entry.worker.on('message', onMessage);
      entry.worker.postMessage({ pdf: transferable, fetchOcsp }, [transferable]);
    });
  }

  /** True only when at least one worker has confirmed it booted. */
  isReady(): boolean {
    return !this.closed && this.pool.some((p) => p.online && !p.retired);
  }

  /** Current pool size. Exposed for health reporting and tests. */
  size(): number {
    return this.pool.length;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const waiter of this.waiting.splice(0)) {
      waiter.reject(new VerifyApiError('internal', 'runner is closing'));
    }
    await Promise.all(this.pool.map((p) => p.worker.terminate().catch(() => undefined)));
    this.pool.length = 0;
  }
}
