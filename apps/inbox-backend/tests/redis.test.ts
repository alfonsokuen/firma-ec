import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import { buildRedis, type RedisHandle } from '../src/redis.js';

describe('redis helpers', () => {
  let handle: RedisHandle;

  beforeEach(() => {
    // ioredis-mock implements the same surface as ioredis; cast at the boundary.
    const mock = new RedisMock() as unknown as Parameters<typeof buildRedis>[0];
    handle = buildRedis(mock);
  });

  afterEach(async () => {
    await handle.client.flushall();
  });

  it('setOtp + getOtp round-trips with TTL', async () => {
    await handle.setOtp('hashAAA', 'pdf-123', 60);
    const got = await handle.getOtp('hashAAA');
    expect(got).toBe('pdf-123');
    const ttl = await handle.client.ttl('otp:hashAAA');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('delOtp removes the entry', async () => {
    await handle.setOtp('hashBBB', 'pdf-456');
    await handle.delOtp('hashBBB');
    expect(await handle.getOtp('hashBBB')).toBeNull();
  });

  it('incrRate increments and returns count', async () => {
    const r1 = await handle.incrRate('phoneHash1', 60);
    expect(r1.count).toBe(1);
    const r2 = await handle.incrRate('phoneHash1', 60);
    expect(r2.count).toBe(2);
    const r3 = await handle.incrRate('phoneHash1', 60);
    expect(r3.count).toBe(3);
  });

  it('incrRate isolates separate phones', async () => {
    await handle.incrRate('phoneA', 60);
    await handle.incrRate('phoneA', 60);
    const rB = await handle.incrRate('phoneB', 60);
    expect(rB.count).toBe(1);
  });
});
