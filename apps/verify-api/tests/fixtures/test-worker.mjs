/**
 * A worker that misbehaves on demand, so the pool's failure handling can be
 * tested without the real 3MB verification bundle.
 *
 * The mode is encoded in the first bytes of the "pdf" the runner transfers,
 * because that is the only channel `WorkerRunner` offers a job.
 *
 *   ECHO  -> reply normally
 *   HANG  -> never reply (forces the verify deadline, then terminate())
 *   EXIT  -> process.exit mid-job (death with no 'error' event)
 *   THROW -> throw asynchronously (death WITH an 'error' event)
 */
import { parentPort } from 'node:worker_threads';

if (process.env.TEST_WORKER_FAIL_BOOT === '1') {
  throw new Error('deliberate boot failure');
}

parentPort.on('message', (job) => {
  const mode = Buffer.from(job.pdf).subarray(0, 5).toString('latin1').trim();
  switch (mode) {
    case 'HANG':
      return;
    case 'EXIT':
      process.exit(7);
      return;
    case 'THROW':
      setTimeout(() => {
        throw new Error('deliberate worker crash');
      }, 5);
      return;
    default:
      parentPort.postMessage({ ok: true, result: { mode, echoed: job.pdf.byteLength } });
  }
});
