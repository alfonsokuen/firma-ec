/**
 * Idempotent replay of a verification.
 *
 * Why this matters here specifically: clients time out and retry. Without a
 * replay cache, a retry re-runs the most expensive operation we offer AND
 * charges the caller's quota a second time for work they already paid for. The
 * cache turns a retry into a lookup.
 *
 * Privacy: we store the VERDICT and a hash of the document, never the document.
 * The whole product rests on not holding people's papers, and a cache is still
 * holding them.
 *
 * Same scope caveat as the quota store: per-process for the pilot; Redis when a
 * second replica exists.
 */

export type IdempotencyOutcome<T> =
  | { kind: 'fresh'; value: T }
  | { kind: 'replayed'; value: T }
  | { kind: 'conflict' }
  | { kind: 'in_flight' };

interface Entry<T> {
  payloadHash: string;
  expiresAt: number;
  state: 'in_flight' | 'done';
  value?: T;
}

export class InMemoryIdempotencyStore<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number = 24 * 60 * 60 * 1000,
    /** Hard cap so a client cycling keys cannot grow this without bound. */
    private readonly maxEntries: number = 10_000,
  ) {}

  /**
   * Run `work` at most once per (keyId, idempotencyKey).
   *
   * A repeat with a DIFFERENT payload is a conflict, not a replay: returning the
   * first document's verdict for a second document would be a silent wrong
   * answer, which is worse than an error.
   */
  async run(
    keyId: string,
    idempotencyKey: string,
    payloadHash: string,
    work: () => Promise<T>,
    now: number = Date.now(),
  ): Promise<IdempotencyOutcome<T>> {
    const cacheKey = `${keyId}:${idempotencyKey}`;
    this.evictExpired(now);

    const existing = this.entries.get(cacheKey);
    if (existing !== undefined) {
      if (existing.payloadHash !== payloadHash) return { kind: 'conflict' };
      if (existing.state === 'in_flight') return { kind: 'in_flight' };
      return { kind: 'replayed', value: existing.value as T };
    }

    this.entries.set(cacheKey, {
      payloadHash,
      state: 'in_flight',
      expiresAt: now + this.ttlMs,
    });

    try {
      const value = await work();
      this.entries.set(cacheKey, {
        payloadHash,
        state: 'done',
        value,
        expiresAt: now + this.ttlMs,
      });
      return { kind: 'fresh', value };
    } catch (err) {
      // A failed attempt must NOT be cached: the client has to be able to retry
      // a transient failure. Drop the reservation and let the error propagate.
      this.entries.delete(cacheKey);
      throw err;
    }
  }

  private evictExpired(now: number): void {
    // Only sweep when there is something plausible to reclaim: doing it on
    // every request is an O(n) walk per call for nothing.
    if (this.entries.size < this.maxEntries / 2) {
      const oldest = this.entries.values().next().value as Entry<T> | undefined;
      if (oldest === undefined || oldest.expiresAt > now) return;
    }
    for (const [k, v] of this.entries) {
      if (v.expiresAt <= now) this.entries.delete(k);
    }
    // Still over the cap after expiry: drop oldest-first (Map preserves
    // insertion order). Losing a replay is acceptable; unbounded memory is not.
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }
}
