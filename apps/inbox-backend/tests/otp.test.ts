import { describe, it, expect } from 'vitest';
import {
  generateOtp,
  hashOtp,
  verifyOtp,
  otpLookupKey,
  storeOtpInRedis,
} from '../src/services/otp.js';
import { buildRedis } from '../src/redis.js';
import RedisMock from 'ioredis-mock';

const PEPPER = 'pepper-fixture-xyz';

describe('generateOtp', () => {
  it('returns a 6-digit numeric string', () => {
    for (let i = 0; i < 25; i++) {
      const otp = generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
    }
  });
});

describe('hashOtp / verifyOtp', () => {
  it('round-trips', async () => {
    const h = await hashOtp('123456', PEPPER);
    expect(await verifyOtp('123456', h, PEPPER)).toBe(true);
  });

  it('rejects wrong otp', async () => {
    const h = await hashOtp('123456', PEPPER);
    expect(await verifyOtp('654321', h, PEPPER)).toBe(false);
  });

  it('rejects wrong pepper', async () => {
    const h = await hashOtp('123456', PEPPER);
    expect(await verifyOtp('123456', h, 'other-pepper')).toBe(false);
  });

  it('hashes are unique per call (random salt)', async () => {
    const a = await hashOtp('111111', PEPPER);
    const b = await hashOtp('111111', PEPPER);
    expect(a).not.toBe(b);
  });

  it('encoded string declares argon2id with expected params', async () => {
    const h = await hashOtp('999999', PEPPER);
    expect(h).toMatch(/^\$argon2id\$/);
    expect(h).toContain('m=65536');
    expect(h).toContain('t=3');
    expect(h).toContain('p=2');
  }, 15_000);
}, 30_000);

describe('otpLookupKey', () => {
  it('is deterministic', () => {
    expect(otpLookupKey('123456', 'k')).toBe(otpLookupKey('123456', 'k'));
    expect(otpLookupKey('123456', 'k')).not.toBe(otpLookupKey('654321', 'k'));
  });
});

describe('storeOtpInRedis', () => {
  it('writes with TTL', async () => {
    const mock = new RedisMock() as unknown as Parameters<typeof buildRedis>[0];
    const handle = buildRedis(mock);
    await storeOtpInRedis(handle, 'lookup-1', 'pdf-1', 60);
    const got = await handle.getOtp('lookup-1');
    expect(got).toBe('pdf-1');
    const ttl = await handle.client.ttl('otp:lookup-1');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
    await handle.client.flushall();
  });
});
