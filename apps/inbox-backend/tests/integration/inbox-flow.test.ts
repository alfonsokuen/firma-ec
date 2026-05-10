/**
 * Integration: /api/inbox/verify → JWT → list → blob → meta with cross-user
 * ownership and JWT-expiry edge cases.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildTestApp, type TestAppHandles } from '../helpers/buildTestApp.js';
import { hashOtp, otpLookupKey } from '../../src/services/otp.js';
import { issueJwt } from '../../src/lib/jwt.js';
import { buildMemoryPrisma } from '../helpers/mockPrisma.js';
import { buildMemoryS3 } from '../helpers/mockS3.js';

describe('integration: inbox flow', () => {
  let h: TestAppHandles;
  let otpA: string;
  let otpAHash: string;
  let otpBHash: string;
  let r2KeyA: string;
  let saltA: Uint8Array;

  beforeEach(async () => {
    otpA = '123456';
    const prisma = buildMemoryPrisma();
    const s3 = buildMemoryS3();
    // For these tests env loads first to compute hashes.
    const { loadEnv } = await import('../../src/env.js');
    const env = loadEnv();
    otpAHash = await hashOtp(otpA, env.INBOX_DEPLOY_SECRET);
    otpBHash = await hashOtp('999999', env.INBOX_DEPLOY_SECRET);
    saltA = new Uint8Array(16).fill(7);
    r2KeyA = 'r2/inboxA.bin';
    // Pre-seed two rows: A owned by otpA, B owned by otpB.
    prisma.pdfs.set('row-A', {
      id: 'row-A',
      otpHash: otpAHash,
      senderPhoneHash: 'phaA',
      messageId: 'msgA',
      r2Key: r2KeyA,
      salt: saltA,
      sizeBytes: 1024,
      ttlAt: new Date(Date.now() + 3_600_000),
      status: 'PENDING',
      createdAt: new Date(),
      consumedAt: null,
      deletedAt: null,
    });
    prisma.pdfs.set('row-B', {
      id: 'row-B',
      otpHash: otpBHash,
      senderPhoneHash: 'phaB',
      messageId: 'msgB',
      r2Key: 'r2/inboxB.bin',
      salt: new Uint8Array(16).fill(9),
      sizeBytes: 2048,
      ttlAt: new Date(Date.now() + 3_600_000),
      status: 'PENDING',
      createdAt: new Date(Date.now() - 1000),
      consumedAt: null,
      deletedAt: null,
    });
    // R2 contents: iv (12 bytes 0xab) || ciphertext "blob-A"
    s3.storage.set(
      r2KeyA,
      Buffer.concat([Buffer.alloc(12, 0xab), Buffer.from('blob-A')]),
    );

    h = await buildTestApp({ prisma, s3 });
    // Pre-load OTP lookup in Redis so /verify can resolve A.
    const lookup = otpLookupKey(otpA, env.INBOX_DEPLOY_SECRET);
    await h.redis.set(`otp:${lookup}`, 'row-A', 'EX', 600);
  });

  afterEach(async () => {
    await h.app.close();
  });

  it('POST /api/inbox/verify with correct OTP returns JWT + items[1]', async () => {
    const res = await h.app.inject({
      method: 'POST', url: '/api/inbox/verify',
      payload: { otp: otpA },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { jwt: string; items: Array<{ id: string; saltB64: string; sizeBytes: number }> };
    expect(body.jwt).toMatch(/^eyJ/);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.id).toBe('row-A');
    expect(body.items[0]?.saltB64).toBe(Buffer.from(saltA).toString('base64'));
    expect(body.items[0]?.sizeBytes).toBe(1024);
  });

  it('POST /api/inbox/verify with bad OTP → 401', async () => {
    const res = await h.app.inject({
      method: 'POST', url: '/api/inbox/verify',
      payload: { otp: '000000' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/inbox returns only own rows (cross-user isolation)', async () => {
    const jwt = await issueJwt(otpAHash, h.env.INBOX_JWT_SECRET);
    const res = await h.app.inject({
      method: 'GET', url: '/api/inbox',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json() as Array<{ id: string }>;
    expect(items.map((i) => i.id)).toEqual(['row-A']);
  });

  it('GET /api/inbox/:id/blob streams ciphertext + x-iv-hex header', async () => {
    const jwt = await issueJwt(otpAHash, h.env.INBOX_JWT_SECRET);
    const res = await h.app.inject({
      method: 'GET', url: '/api/inbox/row-A/blob',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-iv-hex']).toBe('ab'.repeat(12));
    expect(res.rawPayload.toString()).toBe('blob-A');
  });

  it('GET /api/inbox/:id/blob enforces ownership (otpA cannot fetch row-B)', async () => {
    const jwt = await issueJwt(otpAHash, h.env.INBOX_JWT_SECRET);
    const res = await h.app.inject({
      method: 'GET', url: '/api/inbox/row-B/blob',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/inbox/:id/meta returns saltB64+sizeBytes+masked phone', async () => {
    const jwt = await issueJwt(otpAHash, h.env.INBOX_JWT_SECRET);
    const res = await h.app.inject({
      method: 'GET', url: '/api/inbox/row-A/meta',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sizeBytes: number; saltB64: string; senderPhoneMasked: string };
    expect(body.sizeBytes).toBe(1024);
    expect(body.saltB64).toBe(Buffer.from(saltA).toString('base64'));
    expect(body.senderPhoneMasked).toBe('+593 ** *** ****');
  });

  it('GET /api/inbox without bearer → 401', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/inbox' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/inbox/verify with malformed otp body → 422', async () => {
    const res = await h.app.inject({
      method: 'POST', url: '/api/inbox/verify',
      payload: { otp: 'abcdef' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('GET /api/inbox/:id/blob without bearer → 401', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/inbox/row-A/blob' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/inbox/:id/meta cross-user → 404', async () => {
    const jwt = await issueJwt(otpAHash, h.env.INBOX_JWT_SECRET);
    const res = await h.app.inject({
      method: 'GET', url: '/api/inbox/row-B/meta',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/inbox with expired JWT → 401', async () => {
    // Issue a JWT with -10s TTL → already expired.
    const jwt = await issueJwt(otpAHash, h.env.INBOX_JWT_SECRET, -10);
    const res = await h.app.inject({
      method: 'GET', url: '/api/inbox',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(401);
  });
}, 60_000);
