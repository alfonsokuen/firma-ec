/**
 * Per-key quota: request rate, daily volume, and CONCURRENCY.
 *
 * The concurrency semaphore is the one that actually protects the machine. A
 * per-minute bucket bounds how many requests arrive, not how much work runs at
 * once: at 6/min with verifications that can take seconds, an attacker can still
 * pile up simultaneous heavy jobs. Bounding in-flight work is what keeps the
 * event loop responsive and the health probes answering.
 *
 * SCOPE — read before scaling out: this implementation is per PROCESS. With N
 * replicas the effective ceiling is N x quota. That is a deliberate, documented
 * trade for the pilot (one container, no new infrastructure); the moment a
 * second replica exists, this must move to the atomic Redis token bucket that
 * `apps/inbox-backend/src/services/rate-limit.ts` already implements. The seam
 * below exists so that swap does not touch any call site.
 *
 * The quota keys on the API key id — NEVER on the client IP, which this product
 * promises never to record.
 */

export interface QuotaDecision {
  allowed: boolean;
  /** Seconds until the caller may retry. Only meaningful when denied. */
  retryAfterSeconds: number;
  /** Requests left in the current minute. */
  remaining: number;
  /** Unix seconds when the current window resets. */
  resetAt: number;
  reason?: 'rate' | 'daily' | 'concurrency';
}

export interface QuotaStore {
  /** Consume one unit of the per-minute and per-day allowances. */
  consume(keyId: string, perMinute: number, perDay: number, now: number): Promise<QuotaDecision>;
  /** Try to take a concurrency slot. Returns a release function, or null. */
  acquireSlot(keyId: string, maxConcurrent: number): Promise<(() => void) | null>;
}

interface Bucket {
  windowStart: number;
  count: number;
}

export class InMemoryQuotaStore implements QuotaStore {
  private readonly minute = new Map<string, Bucket>();
  private readonly day = new Map<string, Bucket>();
  private readonly inFlight = new Map<string, number>();

  async consume(
    keyId: string,
    perMinute: number,
    perDay: number,
    now: number,
  ): Promise<QuotaDecision> {
    const minuteWindow = Math.floor(now / 60_000) * 60_000;
    const dayWindow = Math.floor(now / 86_400_000) * 86_400_000;

    const m = this.rollOver(this.minute, keyId, minuteWindow);
    const d = this.rollOver(this.day, keyId, dayWindow);
    const resetAt = Math.ceil((minuteWindow + 60_000) / 1000);

    if (d.count >= perDay) {
      return {
        allowed: false,
        reason: 'daily',
        retryAfterSeconds: Math.ceil((dayWindow + 86_400_000 - now) / 1000),
        remaining: 0,
        resetAt,
      };
    }
    if (m.count >= perMinute) {
      return {
        allowed: false,
        reason: 'rate',
        retryAfterSeconds: Math.max(1, Math.ceil((minuteWindow + 60_000 - now) / 1000)),
        remaining: 0,
        resetAt,
      };
    }

    m.count += 1;
    d.count += 1;
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: Math.max(0, perMinute - m.count),
      resetAt,
    };
  }

  async acquireSlot(keyId: string, maxConcurrent: number): Promise<(() => void) | null> {
    const current = this.inFlight.get(keyId) ?? 0;
    if (current >= maxConcurrent) return null;
    this.inFlight.set(keyId, current + 1);

    let released = false;
    return () => {
      // Guard against double release: a caller that releases twice would
      // permanently inflate the key's allowance.
      if (released) return;
      released = true;
      const n = (this.inFlight.get(keyId) ?? 1) - 1;
      if (n <= 0) this.inFlight.delete(keyId);
      else this.inFlight.set(keyId, n);
    };
  }

  private rollOver(map: Map<string, Bucket>, keyId: string, windowStart: number): Bucket {
    const existing = map.get(keyId);
    if (existing === undefined || existing.windowStart !== windowStart) {
      const fresh = { windowStart, count: 0 };
      map.set(keyId, fresh);
      return fresh;
    }
    return existing;
  }
}
