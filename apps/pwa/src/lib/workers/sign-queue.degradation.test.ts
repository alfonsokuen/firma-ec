/**
 * Batch-queue DEGRADATION reporting — defect #5, the worst of the batch.
 *
 * A document signed without an RFC 3161 timestamp (B-B) or without revocation
 * data (B-T) counted as a clean success, and with `onItemSigned` in play the
 * result was handed over and dropped, so NOTHING was left to tell the two apart.
 * 180 PDFs without a timestamp are indistinguishable from 180 good ones — and it
 * surfaces months later, when the receiver validates and the certificate has
 * already expired.
 *
 * So: every item carries an `outcome` (timestampOk / ltvProfile / warnings)
 * whether or not its bytes were retained, and the batch result separates clean
 * successes from degraded ones.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runBatchSign } from './sign-queue';
import { __setSignSessionWorkerFactoryForTests } from './sign-session-bus';
import type { SignSessionWorkerResponse } from './sign-session-bus';

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
}

function installFake(): FakeSessionWorker {
  const w = new FakeSessionWorker();
  __setSignSessionWorkerFactoryForTests(() => w as unknown as Worker);
  return w;
}

const CLEAN_LTV = {
  profile: 'B-LTA' as const,
  longTermAchieved: true,
  archiveAchieved: true,
  embeddedOcspCount: 1,
  embeddedCrlCount: 0,
  warnings: [],
};

/** Answers each signNext according to `answerFor(fileName)`. */
function driveSession(
  w: FakeSessionWorker,
  fileNames: string[],
  answerFor: (fileName: string) => {
    timestamp: unknown;
    ltv?: unknown;
  },
): void {
  let cursor = 0;
  w.addEventListener('posted', (ev: Event) => {
    const msg = (ev as Event & { msg: unknown }).msg as { kind: string; requestId?: string };
    if (msg.kind === 'openSession') {
      Promise.resolve().then(() => w.emit({ kind: 'sessionOpened' }));
      return;
    }
    if (msg.kind !== 'signNext' || !msg.requestId) return;
    const requestId = msg.requestId;
    const fileName = fileNames[Math.min(cursor, fileNames.length - 1)]!;
    cursor += 1;
    Promise.resolve().then(() => {
      const answer = answerFor(fileName);
      w.emit({
        kind: 'signResult',
        requestId,
        signedPdf: new Uint8Array(8).buffer,
        ...answer,
      } as SignSessionWorkerResponse);
    });
  });
}

function makeFile(name: string): File {
  return new File([new Uint8Array(16)], name, { type: 'application/pdf' });
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  __setSignSessionWorkerFactoryForTests(null);
  vi.useRealTimers();
});

describe('defect #5 — degradation is reported even when the bytes are handed over', () => {
  it('a document signed WITHOUT a timestamp is a degraded success, not a clean one', async () => {
    const w = installFake();
    const files = [makeFile('good.pdf'), makeFile('no-tsa.pdf')];
    driveSession(
      w,
      files.map((f) => f.name),
      (name) =>
        name === 'no-tsa.pdf'
          ? {
              timestamp: { ok: false, reason: 'rate_limited' },
              ltv: {
                ...CLEAN_LTV,
                profile: 'B-B',
                longTermAchieved: false,
                archiveAchieved: false,
              },
            }
          : { timestamp: { ok: true, tsaUrl: 'https://freetsa.org/tsr' }, ltv: CLEAN_LTV },
    );

    // With onItemSigned the results are released — the outcome must survive it.
    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
      tsaMaxAttempts: 1,
      onItemSigned: () => Promise.resolve(),
    });

    expect(result.succeeded).toBe(2);
    expect(result.succeededDegraded).toBe(1);
    expect(result.failed).toBe(0);

    const clean = result.items[0]!;
    const degraded = result.items[1]!;
    expect(clean.result).toBeUndefined();
    expect(degraded.result).toBeUndefined(); // bytes released, outcome kept
    expect(clean.outcome).toMatchObject({ timestampOk: true, degraded: false });
    expect(degraded.outcome).toMatchObject({
      timestampOk: false,
      timestampReason: 'rate_limited',
      ltvProfile: 'B-B',
      degraded: true,
    });
  });

  it('records the LTV warnings that explain WHY it degraded (the network cause is named)', async () => {
    const w = installFake();
    const files = [makeFile('a.pdf')];
    driveSession(w, ['a.pdf'], () => ({
      timestamp: { ok: true, tsaUrl: 'https://freetsa.org/tsr' },
      ltv: {
        profile: 'B-T',
        longTermAchieved: false,
        archiveAchieved: false,
        embeddedOcspCount: 0,
        embeddedCrlCount: 0,
        warnings: [{ code: 'ocsp_timeout' }, { code: 'crl_timeout' }],
      },
    }));

    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
      onItemSigned: () => Promise.resolve(),
    });

    expect(result.succeededDegraded).toBe(1);
    const outcome = result.items[0]!.outcome!;
    expect(outcome.degraded).toBe(true);
    expect(outcome.ltvProfile).toBe('B-T');
    expect(outcome.warnings.map((wn) => wn.code)).toEqual(['ocsp_timeout', 'crl_timeout']);
  });

  it('a user who turned the timestamp OFF is not reported as degraded', async () => {
    const w = installFake();
    const files = [makeFile('a.pdf')];
    driveSession(w, ['a.pdf'], () => ({
      timestamp: { ok: false, reason: 'user_disabled' },
      ltv: {
        profile: 'B-B',
        longTermAchieved: false,
        archiveAchieved: false,
        embeddedOcspCount: 0,
        embeddedCrlCount: 0,
        warnings: [],
      },
    }));

    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
      timestampEnabled: false,
      ltvEnabled: false,
      onItemSigned: () => Promise.resolve(),
    });

    expect(result.succeeded).toBe(1);
    expect(result.succeededDegraded).toBe(0);
    expect(result.items[0]?.outcome).toMatchObject({ degraded: false, timestampOk: false });
  });

  it('a whole batch of 5 without timestamps is visible as 5 degraded, not 5 clean', async () => {
    const w = installFake();
    const files = ['a', 'b', 'c', 'd', 'e'].map((n) => makeFile(`${n}.pdf`));
    driveSession(
      w,
      files.map((f) => f.name),
      () => ({
        timestamp: { ok: false, reason: 'timeout' },
        ltv: {
          profile: 'B-B',
          longTermAchieved: false,
          archiveAchieved: false,
          embeddedOcspCount: 0,
          embeddedCrlCount: 0,
          warnings: [],
        },
      }),
    );

    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
      tsaMaxAttempts: 1,
      onItemSigned: () => Promise.resolve(),
    });

    expect(result.succeeded).toBe(5);
    expect(result.succeededDegraded).toBe(5);
    expect(result.items.every((i) => i.outcome?.degraded === true)).toBe(true);
  });

  // 2026-08-05 HIGH-4 fix (independent code-reviewer pass on F1): the batch
  // path never read `chainComplete`/`missingIssuerDn` from the worker's
  // signResult — only the single-document path did. A document with an
  // incomplete embedded chain (bundle miss + failed AIA fallback) looked
  // like a clean success in the batch UI.
  it('a document with an incomplete embedded chain is a degraded success, with a chain_incomplete warning', async () => {
    const w = installFake();
    const files = [makeFile('incomplete-chain.pdf')];
    driveSession(
      w,
      ['incomplete-chain.pdf'],
      () =>
        ({
          timestamp: { ok: true, tsaUrl: 'https://freetsa.org/tsr' },
          ltv: CLEAN_LTV,
          chainComplete: false,
          missingIssuerDn: 'CN=Unresolved Sub CA',
        }) as unknown as { timestamp: unknown; ltv?: unknown },
    );

    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
      onItemSigned: () => Promise.resolve(),
    });

    expect(result.succeededDegraded).toBe(1);
    const outcome = result.items[0]!.outcome!;
    expect(outcome.degraded).toBe(true);
    expect(outcome.warnings).toContainEqual({
      code: 'chain_incomplete',
      detail: 'CN=Unresolved Sub CA',
    });
  });

  it('chainComplete: null (older cached worker bundle) is treated as unknown, not a warning', async () => {
    const w = installFake();
    const files = [makeFile('unknown-chain.pdf')];
    driveSession(w, ['unknown-chain.pdf'], () => ({
      timestamp: { ok: true, tsaUrl: 'https://freetsa.org/tsr' },
      ltv: CLEAN_LTV,
    }));

    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
      onItemSigned: () => Promise.resolve(),
    });

    const outcome = result.items[0]!.outcome!;
    expect(outcome.degraded).toBe(false);
    expect(outcome.warnings.map((wn) => wn.code)).not.toContain('chain_incomplete');
  });
});
