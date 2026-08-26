/**
 * The worker pool's failure handling, exercised against a REAL `Worker`.
 *
 * This file exists because two independent reviewers found three P0 defects in
 * this class and every one of them lived in code with no test at all — the
 * suite injected a fake runner, so the mode that actually ships (workers) had
 * zero coverage. Each test below reproduces one of those defects.
 *
 * The worker under test is `fixtures/test-worker.mjs`, which misbehaves on
 * command; using the real verification bundle would make these tests slow and
 * would test the engine rather than the pool.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { WorkerRunner } from '../src/services/verifyRunner.js';

const WORKER = pathToFileURL(resolve(__dirname, 'fixtures/test-worker.mjs'));

const job = (mode: string): Buffer => Buffer.from(mode.padEnd(64, ' '), 'latin1');

let runner: WorkerRunner | undefined;
afterEach(async () => {
  await runner?.close();
  runner = undefined;
});

/** Wait until `predicate` holds, or fail — never a bare sleep. */
async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition never held');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('the pool keeps its size', () => {
  test('a healthy job returns its result and frees the worker', async () => {
    runner = new WorkerRunner(WORKER, 2);
    const result = (await runner.run(job('ECHO'), false, 5000)) as { mode: string };
    expect(result.mode).toBe('ECHO');
    expect(runner.size()).toBe(2);
  });

  test('REGRESSION: repeated timeouts do not grow the pool', async () => {
    // The original bug: `exit` and the terminate continuation BOTH replaced the
    // worker, so the pool grew by one per timeout (2 -> 3 -> 4 -> 5) and
    // VERIFY_WORKERS stopped bounding concurrent heavy work.
    runner = new WorkerRunner(WORKER, 2);
    for (let i = 0; i < 3; i += 1) {
      await expect(runner.run(job('HANG'), false, 60)).rejects.toMatchObject({
        code: 'verify_timeout',
      });
    }
    await until(() => runner!.size() === 2);
    expect(runner.size()).toBe(2);
  });

  test('the replacement worker is usable, so the pool actually recovers', async () => {
    runner = new WorkerRunner(WORKER, 1);
    await expect(runner.run(job('HANG'), false, 60)).rejects.toMatchObject({
      code: 'verify_timeout',
    });
    await until(() => runner!.isReady());
    const result = (await runner.run(job('ECHO'), false, 5000)) as { mode: string };
    expect(result.mode).toBe('ECHO');
    expect(runner.size()).toBe(1);
  });
});

describe('a dying worker fails its request honestly', () => {
  test('a worker that exits mid-job reports worker_died, not a bogus timeout', async () => {
    // Before the fix the request waited out the FULL verify deadline and then
    // reported `verify_timeout` — blaming the document for a crash. With a 60s
    // production deadline that is a minute of silence per incident.
    runner = new WorkerRunner(WORKER, 1);
    const started = Date.now();
    await expect(runner.run(job('EXIT'), false, 30_000)).rejects.toMatchObject({
      code: 'worker_died',
    });
    // The point is that it does NOT wait for the deadline.
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test('a worker that throws mid-job also reports worker_died', async () => {
    runner = new WorkerRunner(WORKER, 1);
    await expect(runner.run(job('THROW'), false, 30_000)).rejects.toMatchObject({
      code: 'worker_died',
    });
  });

  test('an idle worker crashing does not take the process down', async () => {
    // The 'error' listener used to exist only during run(); an unhandled
    // 'error' on a Worker is fatal to the process.
    runner = new WorkerRunner(WORKER, 1);
    await expect(runner.run(job('THROW'), false, 30_000)).rejects.toMatchObject({
      code: 'worker_died',
    });
    await until(() => runner!.isReady());
    const result = (await runner.run(job('ECHO'), false, 5000)) as { mode: string };
    expect(result.mode).toBe('ECHO');
  });
});

describe('load shedding instead of hanging', () => {
  test('waiting for a worker has its own deadline', async () => {
    runner = new WorkerRunner(WORKER, 1, { queueTimeoutMs: 100 });
    // Occupy the only worker for longer than the queue deadline.
    const busy = runner.run(job('HANG'), false, 3_000).catch(() => undefined);
    const started = Date.now();
    await expect(runner.run(job('ECHO'), false, 30_000)).rejects.toMatchObject({
      code: 'service_busy',
    });
    expect(Date.now() - started).toBeLessThan(3_000);
    await busy;
  });

  test('a full queue sheds load immediately rather than growing without bound', async () => {
    runner = new WorkerRunner(WORKER, 1, { queueTimeoutMs: 5_000, maxQueue: 2 });
    const busy = runner.run(job('HANG'), false, 3_000).catch(() => undefined);
    const queued = [
      runner.run(job('ECHO'), false, 3_000).catch((e: { code?: string }) => e.code),
      runner.run(job('ECHO'), false, 3_000).catch((e: { code?: string }) => e.code),
    ];
    // Queue is full (2); this one must be refused right away.
    await expect(runner.run(job('ECHO'), false, 3_000)).rejects.toMatchObject({
      code: 'service_busy',
    });
    await busy;
    await Promise.all(queued);
  });
});

describe('readiness tells the truth', () => {
  test('a runner whose workers cannot boot reports NOT ready', async () => {
    process.env['TEST_WORKER_FAIL_BOOT'] = '1';
    try {
      const spawns: string[] = [];
      runner = new WorkerRunner(WORKER, 1, {
        log: (_level, event) => spawns.push(event),
      });
      // Give it time to fail, back off, and fail again.
      await until(() => spawns.filter((e) => e === 'worker_error').length >= 1, 5_000);
      expect(runner.isReady()).toBe(false);

      // And it must NOT respawn in a hot loop: an earlier version span 379
      // workers in 3 seconds while the health probe stayed green.
      const before = spawns.length;
      await new Promise((r) => setTimeout(r, 500));
      expect(spawns.length - before).toBeLessThan(20);
    } finally {
      delete process.env['TEST_WORKER_FAIL_BOOT'];
    }
  });

  test('close() releases everything and refuses further work', async () => {
    const r = new WorkerRunner(WORKER, 2);
    await r.close();
    expect(r.size()).toBe(0);
    expect(r.isReady()).toBe(false);
    await expect(r.run(job('ECHO'), false, 1000)).rejects.toThrow();
  });
});
