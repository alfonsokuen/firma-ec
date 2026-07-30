/**
 * Batch-queue error CLASSIFICATION — defects #4 and #10.
 *
 *   #4  "the session is dead" was decided by a loose `.code` string, so ANY
 *       error carrying `code: 'timeout'` — a File read, the caller's persistence
 *       layer — declared a perfectly healthy session dead and aborted the rest
 *       of the batch. Only an error that PROVES the session died may do that,
 *       and that is a matter of TYPE: `SignSessionError` + a fatal code.
 *   #10 `DOMException.code` is a NUMBER. Reading it as the error code produced
 *       `error.code === 8` in a field typed `string`, and threw away `err.name`
 *       — the only part a human could act on.
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
        ltv: {
          profile: 'B-LTA',
          longTermAchieved: true,
          archiveAchieved: true,
          embeddedOcspCount: 1,
          embeddedCrlCount: 0,
          warnings: [],
        },
      }),
    );
  });
}

function makeFile(name: string, sizeBytes = 16): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: 'application/pdf' });
}

/** A File whose bytes cannot be read, failing with `err`. */
function makeUnreadableFile(name: string, err: unknown): File {
  const file = makeFile(name);
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => Promise.reject(err),
    configurable: true,
  });
  return file;
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  __setSignSessionWorkerFactoryForTests(null);
  vi.useRealTimers();
});

describe('defect #4 — only a SESSION error may declare the session dead', () => {
  it('a File read that fails with code:"timeout" does NOT abort the rest of the batch', async () => {
    const w = installFake();
    driveHappySession(w);
    const unreadable = makeUnreadableFile(
      'locked.pdf',
      Object.assign(new Error('read timed out'), {
        code: 'timeout',
      }),
    );
    const files = [unreadable, makeFile('b.pdf'), makeFile('c.pdf')];

    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
    });

    expect(result.items[0]?.status).toBe('failed');
    expect(result.items[0]?.error).toMatchObject({ code: 'timeout' });
    // The session was never touched by that failure.
    expect(result.items[1]?.status).toBe('done');
    expect(result.items[2]?.status).toBe('done');
    expect(result.items.some((i) => i.error?.code === 'session_aborted')).toBe(false);
    expect(result.succeeded).toBe(2);
  });
});

describe('defect #10 — a numeric DOMException code never lands in error.code', () => {
  it('keeps a STRING code (the name) and preserves the numeric one in the message', async () => {
    const w = installFake();
    driveHappySession(w);
    // Shape of a real DOMException: numeric `code`, meaningful `name`.
    const domish = Object.assign(new Error('The requested file could not be read'), {
      name: 'NotReadableError',
      code: 8,
    });
    const files = [makeUnreadableFile('gone.pdf', domish), makeFile('b.pdf')];

    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
    });

    const failed = result.items[0]!;
    expect(failed.status).toBe('failed');
    expect(typeof failed.error?.code).toBe('string');
    expect(failed.error?.code).toBe('NotReadableError');
    expect(failed.error?.message).toContain('could not be read');
    expect(failed.error?.message).toContain('8'); // the numeric code is not lost
    // And a numeric code cannot pass the fatal check either.
    expect(result.items[1]?.status).toBe('done');
  });

  it('falls back to a named code when the error carries neither code nor name', async () => {
    const w = installFake();
    driveHappySession(w);
    const bare = { toString: () => 'something odd' };
    const result = await runBatchSign(
      [makeUnreadableFile('odd.pdf', bare)],
      new ArrayBuffer(8),
      'pin',
      {
        closeAckTimeoutMs: 50,
      },
    );

    expect(result.items[0]?.error?.code).toBe('unknown');
    expect(typeof result.items[0]?.error?.message).toBe('string');
    expect(result.items[0]?.error?.message.length).toBeGreaterThan(0);
  });
});
