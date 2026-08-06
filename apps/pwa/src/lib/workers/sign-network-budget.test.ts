/**
 * Defect #1 (queue half) — the network budget of ONE document must be
 * demonstrably SMALLER than that document's signing timeout.
 *
 * Before this, the reachable network budget per document was ~56-64s (TSA 8s +
 * OCSP/CRL 8s per leg over a 3-cert chain + LTA doc-timestamp 8s) against a
 * document budget of 15.1s for a 100 KB PDF: the inequality ran backwards, so a
 * hung responder ALWAYS surfaced as a document `timeout` — the one code that
 * killed the whole batch — instead of as a reported degradation.
 *
 * Same style as `assertLimitFitsTimeoutBudget` in sign-queue.ts: the invariant
 * is asserted here AND at module load, so the two cannot drift apart.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BATCH_FILE_SIZE_BYTES, deriveNetworkBudget, runBatchSign } from './sign-queue';
import {
  SESSION_TIMEOUT_BASE_MS,
  __setSignSessionWorkerFactoryForTests,
  computeSignSessionTimeoutMs,
} from './sign-session-bus';
import type { SignSessionWorkerResponse } from './sign-session-bus';

class FakeSessionWorker extends EventTarget {
  public readonly postedMessages: unknown[] = [];
  public terminated = 0;

  postMessage(msg: unknown): void {
    this.postedMessages.push(msg);
    this.dispatchEvent(Object.assign(new Event('posted'), { msg }));
    if ((msg as { kind?: string }).kind === 'closeSession') {
      Promise.resolve().then(() => this.emit({ kind: 'sessionClosed' }));
    }
  }

  terminate(): void {
    this.terminated += 1;
  }

  emit(data: SignSessionWorkerResponse): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data }));
  }
}

function installFake(): FakeSessionWorker {
  const w = new FakeSessionWorker();
  __setSignSessionWorkerFactoryForTests(() => w as unknown as Worker);
  return w;
}

function driveHappySession(w: FakeSessionWorker): void {
  w.addEventListener('posted', (ev: Event) => {
    const msg = (ev as Event & { msg: unknown }).msg as { kind: string; requestId?: string };
    if (msg.kind === 'openSession') {
      Promise.resolve().then(() => w.emit({ kind: 'sessionOpened' }));
      return;
    }
    if (msg.kind !== 'signNext' || !msg.requestId) return;
    const requestId = msg.requestId;
    Promise.resolve().then(() =>
      w.emit({
        kind: 'signResult',
        requestId,
        signedPdf: new Uint8Array(8).buffer,
        timestamp: { ok: true, tsaUrl: 'https://freetsa.org/tsr' },
      }),
    );
  });
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  __setSignSessionWorkerFactoryForTests(null);
  vi.useRealTimers();
});

describe('the network budget fits inside the document budget (defect #1)', () => {
  const SIZES = [0, 1024, 100 * 1024, 5 * 1024 * 1024, MAX_BATCH_FILE_SIZE_BYTES];

  it.each(SIZES)('Σ(network timeouts) < document timeout for a %d-byte PDF', (size) => {
    const docBudget = computeSignSessionTimeoutMs(size);
    const budget = deriveNetworkBudget(docBudget);
    expect(budget.totalMs).toBeLessThan(docBudget);
  });

  it('the worst case — the SMALLEST document budget — still leaves room for the CPU work', () => {
    const budget = deriveNetworkBudget(SESSION_TIMEOUT_BASE_MS);
    expect(budget.totalMs).toBeLessThan(SESSION_TIMEOUT_BASE_MS);
    // The signature itself (hash + PKCS#7 + DSS append) needs real time too.
    expect(SESSION_TIMEOUT_BASE_MS - budget.totalMs).toBeGreaterThan(0);
    expect(budget.tsaTimeoutMs).toBeGreaterThan(0);
    expect(budget.ltvBudgetMs).toBeGreaterThan(0);
    expect(budget.ltvTimeoutMs).toBeLessThanOrEqual(budget.ltvBudgetMs);
  });

  // 2026-08-05 HIGH-3 fix (independent code-reviewer pass on F1): the AIA
  // caIssuers fallback walk (up to 8 hops) previously had NO share of the
  // network budget at all — this is the same reachable-unbounded-network
  // failure mode defect #1 fixed for TSA/OCSP/CRL, just for a leg that was
  // added later (F1) without being folded into the same accounting.
  it('reserves a non-zero AIA budget/timeout, and it still fits inside the total (defect #1, HIGH-3)', () => {
    const budget = deriveNetworkBudget(SESSION_TIMEOUT_BASE_MS);
    expect(budget.aiaBudgetMs).toBeGreaterThan(0);
    expect(budget.aiaTimeoutMs).toBeGreaterThan(0);
    expect(budget.aiaTimeoutMs).toBeLessThanOrEqual(budget.aiaBudgetMs);
    expect(budget.tsaTimeoutMs + budget.ltvBudgetMs + budget.aiaBudgetMs).toBe(budget.totalMs);
    expect(budget.totalMs).toBeLessThan(SESSION_TIMEOUT_BASE_MS);
  });
});

describe('runBatchSign passes the derived budget to the worker (defect #1)', () => {
  it('every signNext carries tsaTimeoutMs / ltvTimeoutMs / ltvBudgetMs / aiaTimeoutMs / aiaBudgetMs inside the document budget', async () => {
    const w = installFake();
    driveHappySession(w);
    const file = new File([new Uint8Array(2048)], 'a.pdf', { type: 'application/pdf' });

    await runBatchSign([file], new ArrayBuffer(8), 'pin', { closeAckTimeoutMs: 50 });

    const req = w.postedMessages.find((m) => (m as { kind: string }).kind === 'signNext') as {
      tsaTimeoutMs?: number;
      ltvTimeoutMs?: number;
      ltvBudgetMs?: number;
      aiaTimeoutMs?: number;
      aiaBudgetMs?: number;
    };
    const docBudget = computeSignSessionTimeoutMs(file.size);
    expect(req.tsaTimeoutMs).toBeGreaterThan(0);
    expect(req.ltvBudgetMs).toBeGreaterThan(0);
    expect(req.ltvTimeoutMs).toBeGreaterThan(0);
    expect(req.aiaTimeoutMs, 'HIGH-3: the AIA leg must carry a budget too').toBeGreaterThan(0);
    expect(req.aiaBudgetMs).toBeGreaterThan(0);
    expect(req.tsaTimeoutMs! + req.ltvBudgetMs! + req.aiaBudgetMs!).toBeLessThan(docBudget);
  });

  it('a caller-supplied timeout larger than its share is CLAMPED, not honoured', async () => {
    const w = installFake();
    driveHappySession(w);
    const file = new File([new Uint8Array(16)], 'a.pdf', { type: 'application/pdf' });

    await runBatchSign([file], new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
      // What the settings store hands over today: the single-shot defaults.
      tsaTimeoutMs: 8000,
      ltvTimeoutMs: 8000,
    });

    const req = w.postedMessages.find((m) => (m as { kind: string }).kind === 'signNext') as {
      tsaTimeoutMs?: number;
      ltvTimeoutMs?: number;
      ltvBudgetMs?: number;
    };
    const docBudget = computeSignSessionTimeoutMs(file.size);
    expect(req.tsaTimeoutMs).toBeLessThan(8000);
    expect(req.tsaTimeoutMs! + req.ltvBudgetMs!).toBeLessThan(docBudget);
  });
});
