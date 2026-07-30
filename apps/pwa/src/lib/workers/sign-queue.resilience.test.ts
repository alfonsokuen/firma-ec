/**
 * Batch-queue RESILIENCE — defect #2 plus the per-batch circuit breakers.
 *
 *   #2  A per-document `timeout` killed the worker AND the batch: `'timeout'`
 *       being in SESSION_FATAL_CODES meant document 1 of 200 aborted the other
 *       199 with `session_aborted` and no diagnosis. But `runBatchSign` holds the
 *       .p12 and the PIN, so it can REOPEN the session and carry on. Cap: 2
 *       reopens per batch — a transient hiccup recovers, a systemic failure does
 *       not turn 200 documents into a retry storm.
 *   Breakers: a dead OCSP responder must not cost 8s × N documents. After the
 *       first `ocsp_timeout`/`crl_timeout` the rest of the batch stops retrying
 *       that leg (delivering B-T/B-B, marked degraded); after k consecutive
 *       documents whose TSA retries were exhausted, the rest stops retrying the
 *       TSA.
 *
 * The last test is the extreme end-to-end scenario from the spec.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_SESSION_REOPENS, runBatchSign } from './sign-queue';
import { __setSignSessionWorkerFactoryForTests } from './sign-session-bus';
import type { SignSessionWorkerResponse } from './sign-session-bus';

interface SignNextMsg {
  kind: string;
  requestId?: string;
  ltvEnabled?: boolean;
}

class FakeSessionWorker extends EventTarget {
  public readonly postedMessages: unknown[] = [];
  public terminated = 0;

  postMessage(msg: unknown): void {
    this.postedMessages.push(msg);
    this.dispatchEvent(Object.assign(new Event('posted'), { msg }));
    if ((msg as { kind?: string }).kind === 'closeSession') {
      Promise.resolve().then(() => this.emit({ kind: 'sessionClosed', wiped: true }));
    }
  }

  terminate(): void {
    this.terminated += 1;
  }

  emit(data: SignSessionWorkerResponse): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data }));
  }

  signNexts(): SignNextMsg[] {
    return this.postedMessages.filter(
      (m) => (m as SignNextMsg).kind === 'signNext',
    ) as SignNextMsg[];
  }

  opens(): number {
    return this.postedMessages.filter((m) => (m as { kind: string }).kind === 'openSession').length;
  }
}

const CLEAN_LTV = {
  profile: 'B-LTA' as const,
  longTermAchieved: true,
  archiveAchieved: true,
  embeddedOcspCount: 1,
  embeddedCrlCount: 0,
  warnings: [] as Array<{ code: string }>,
};

const OK_TS = { ok: true as const, tsaUrl: 'https://freetsa.org/tsr' };

type Answer =
  | { kind: 'silence' }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'ok'; timestamp?: unknown; ltv?: unknown };

/**
 * Installs a fake worker whose answer to each signNext is decided by
 * `answerFor(attemptIndex, msg)` — attemptIndex counts EVERY signNext of the
 * batch (retries included), which is what the tests below reason about.
 */
function installDrivenFake(answerFor: (attemptIndex: number, msg: SignNextMsg) => Answer): FakeSessionWorker {
  const w = new FakeSessionWorker();
  __setSignSessionWorkerFactoryForTests(() => w as unknown as Worker);
  let attempt = 0;
  w.addEventListener('posted', (ev: Event) => {
    const msg = (ev as Event & { msg: unknown }).msg as SignNextMsg;
    if (msg.kind === 'openSession') {
      Promise.resolve().then(() => w.emit({ kind: 'sessionOpened' }));
      return;
    }
    if (msg.kind !== 'signNext' || !msg.requestId) return;
    const requestId = msg.requestId;
    const answer = answerFor(attempt, msg);
    attempt += 1;
    if (answer.kind === 'silence') return;
    Promise.resolve().then(() => {
      if (answer.kind === 'error') {
        w.emit({ kind: 'signError', requestId, code: answer.code, message: answer.message });
        return;
      }
      w.emit({
        kind: 'signResult',
        requestId,
        signedPdf: new Uint8Array(8).buffer,
        timestamp: answer.timestamp ?? OK_TS,
        ltv: answer.ltv ?? CLEAN_LTV,
      } as SignSessionWorkerResponse);
    });
  });
  return w;
}

function makeFiles(names: string[]): File[] {
  return names.map((n) => new File([new Uint8Array(16)], n, { type: 'application/pdf' }));
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  __setSignSessionWorkerFactoryForTests(null);
  vi.useRealTimers();
});

describe('defect #2 — a document timeout does not abort the rest of the batch', () => {
  it('reopens the session and signs the remaining documents', async () => {
    // Document 1 gets no answer at all → its per-document timeout fires.
    const w = installDrivenFake((attempt) => (attempt === 0 ? { kind: 'silence' } : { kind: 'ok' }));
    const files = makeFiles(['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf', 'e.pdf']);

    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      signTimeoutMs: 40,
      closeAckTimeoutMs: 50,
    });

    expect(result.items[0]?.status).toBe('failed');
    expect(result.items[0]?.error).toMatchObject({ code: 'timeout' });
    expect(result.items.slice(1).map((i) => i.status)).toEqual(['done', 'done', 'done', 'done']);
    expect(result.succeeded).toBe(4);
    expect(result.items.some((i) => i.error?.code === 'session_aborted')).toBe(false);
    // Exactly one reopen: the original open plus one more.
    expect(w.opens()).toBe(2);
  });

  it('gives up after MAX_SESSION_REOPENS and says so on the untouched tail', async () => {
    // Every document times out: the batch must stop, not loop forever.
    const w = installDrivenFake(() => ({ kind: 'silence' }));
    const files = makeFiles(['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf', 'e.pdf']);

    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      signTimeoutMs: 30,
      closeAckTimeoutMs: 30,
    });

    // 1 + MAX_SESSION_REOPENS documents were attempted; the rest were not.
    const attempted = MAX_SESSION_REOPENS + 1;
    expect(w.signNexts()).toHaveLength(attempted);
    expect(w.opens()).toBe(1 + MAX_SESSION_REOPENS);
    for (let i = 0; i < attempted; i++) {
      expect(result.items[i]?.error).toMatchObject({ code: 'timeout' });
    }
    for (let i = attempted; i < files.length; i++) {
      expect(result.items[i]?.error).toMatchObject({ code: 'session_aborted' });
    }
    expect(result.failed).toBe(files.length);
  });
});

describe('per-batch circuit breakers — a dead responder cannot cost 8s × N', () => {
  it('stops asking for revocation data after the first ocsp_timeout, marking the rest degraded', async () => {
    const stalledLtv = {
      profile: 'B-T',
      longTermAchieved: false,
      archiveAchieved: false,
      embeddedOcspCount: 0,
      embeddedCrlCount: 0,
      warnings: [{ code: 'ocsp_timeout' }, { code: 'crl_timeout' }],
    };
    const w = installDrivenFake((attempt) =>
      attempt === 0 ? { kind: 'ok', ltv: stalledLtv } : { kind: 'ok', ltv: stalledLtv },
    );
    const files = makeFiles(['a.pdf', 'b.pdf', 'c.pdf']);

    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
    });

    const requests = w.signNexts();
    expect(requests).toHaveLength(3);
    // Document 1 asked for LTV; the rest did not.
    expect(requests[0]?.ltvEnabled).not.toBe(false);
    expect(requests[1]?.ltvEnabled).toBe(false);
    expect(requests[2]?.ltvEnabled).toBe(false);
    // And nothing is silently downgraded: every one of them is degraded.
    expect(result.succeeded).toBe(3);
    expect(result.succeededDegraded).toBe(3);
    expect(
      result.items[1]?.outcome?.warnings.some((wn) => wn.code === 'ltv_skipped_circuit_open'),
    ).toBe(true);
  });

  it('stops retrying the TSA after k consecutive documents exhausted their retries', async () => {
    const rateLimited = { ok: false, reason: 'rate_limited' };
    const noTsaLtv = {
      profile: 'B-B',
      longTermAchieved: false,
      archiveAchieved: false,
      embeddedOcspCount: 0,
      embeddedCrlCount: 0,
      warnings: [] as Array<{ code: string }>,
    };
    const w = installDrivenFake(() => ({ kind: 'ok', timestamp: rateLimited, ltv: noTsaLtv }));
    const files = makeFiles(['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf']);

    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
      tsaMaxAttempts: 3,
      tsaRetryBackoffsMs: [1, 1],
      // LTV off so the LTV breaker doesn't interfere with the count.
      ltvEnabled: false,
    });

    // Without the breaker this is 4 × 3 = 12 signNext calls. With it, only the
    // first documents pay for retries.
    const attempts = w.signNexts().length;
    expect(attempts).toBeLessThan(12);
    expect(attempts).toBeGreaterThanOrEqual(4); // every document still signed once
    expect(result.succeeded).toBe(4);
    expect(result.succeededDegraded).toBe(4);
    expect(
      result.items[3]?.outcome?.warnings.some((wn) => wn.code === 'tsa_retries_disabled_circuit_open'),
    ).toBe(true);
  });
});

describe('extreme scenario (spec criterion 2) — a hung OCSP on document #1', () => {
  it('the other 4 are signed, #1 names the network cause, nothing is session_aborted, and clean ≠ degraded', async () => {
    const degradedLtv = {
      profile: 'B-T',
      longTermAchieved: false,
      archiveAchieved: false,
      embeddedOcspCount: 0,
      embeddedCrlCount: 0,
      warnings: [{ code: 'ocsp_timeout', detail: 'responder did not answer in budget' }],
    };
    // #1: the worker gives up on the stalled responder and reports the network
    // cause. #2-#3 degrade (the breaker skipped the leg). #4-#5 are clean.
    const w = installDrivenFake((attempt) => {
      if (attempt === 0) {
        return { kind: 'error', code: 'ocsp_timeout', message: 'OCSP responder did not answer' };
      }
      if (attempt <= 2) return { kind: 'ok', ltv: degradedLtv };
      return { kind: 'ok' };
    });
    const files = makeFiles(['1.pdf', '2.pdf', '3.pdf', '4.pdf', '5.pdf']);

    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
      tsaMaxAttempts: 1,
    });

    // The stalled document failed, and its code NAMES the cause.
    expect(result.items[0]?.status).toBe('failed');
    expect(result.items[0]?.error?.code).toBe('ocsp_timeout');
    // The other four were signed.
    expect(result.items.slice(1).every((i) => i.status === 'done')).toBe(true);
    expect(result.succeeded).toBe(4);
    // Nobody was aborted by association.
    expect(result.items.some((i) => i.error?.code === 'session_aborted')).toBe(false);
    // Clean and degraded are distinguishable.
    expect(result.succeededDegraded).toBe(2);
    expect(result.succeeded - result.succeededDegraded).toBe(2);
  });
});
