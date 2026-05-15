import type { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { BUCKETS, checkAndConsume } from '../src/services/rate-limit.js';

describe('checkAndConsume', () => {
  let redis: Redis;
  beforeEach(() => {
    redis = new RedisMock() as unknown as Redis;
  });

  it('allows first request, denies second within window', async () => {
    const spec = BUCKETS.msgPerPhone('phone-A');
    const t0 = 1_000_000;
    const r1 = await checkAndConsume(redis, spec, t0);
    expect(r1.ok).toBe(true);
    const r2 = await checkAndConsume(redis, spec, t0 + 1_000); // 1s later
    expect(r2.ok).toBe(false);
    expect(r2.retryAfterS).toBeGreaterThan(0);
    expect(r2.retryAfterS).toBeLessThanOrEqual(30);
  });

  it('refills after window elapses (msg bucket: 30s)', async () => {
    const spec = BUCKETS.msgPerPhone('phone-B');
    const t0 = 5_000_000;
    const r1 = await checkAndConsume(redis, spec, t0);
    expect(r1.ok).toBe(true);
    const r2 = await checkAndConsume(redis, spec, t0 + 31_000);
    expect(r2.ok).toBe(true);
  });

  it('isolates buckets per key', async () => {
    const t0 = 9_000_000;
    const a1 = await checkAndConsume(redis, BUCKETS.msgPerPhone('A'), t0);
    const b1 = await checkAndConsume(redis, BUCKETS.msgPerPhone('B'), t0);
    expect(a1.ok).toBe(true);
    expect(b1.ok).toBe(true);
  });

  it('pdfPerDay allows 5, denies 6th', async () => {
    const spec = BUCKETS.pdfPerDay('phone-C');
    const t0 = 10_000_000;
    for (let i = 0; i < 5; i++) {
      const r = await checkAndConsume(redis, spec, t0);
      expect(r.ok, `attempt ${i}`).toBe(true);
    }
    const r6 = await checkAndConsume(redis, spec, t0);
    expect(r6.ok).toBe(false);
  });

  it('otpPerIp allows 10, denies 11th', async () => {
    const spec = BUCKETS.otpPerIp('1.2.3.4');
    const t0 = 20_000_000;
    for (let i = 0; i < 10; i++) {
      const r = await checkAndConsume(redis, spec, t0);
      expect(r.ok, `attempt ${i}`).toBe(true);
    }
    const r11 = await checkAndConsume(redis, spec, t0);
    expect(r11.ok).toBe(false);
  });
});
