import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';
import { issueJwt } from '../src/lib/jwt.js';
import { buildServer } from '../src/server.js';
import { hashOtp, otpLookupKey } from '../src/services/otp.js';

interface FakeRow {
  id: string;
  otpHash: string;
  senderPhoneHash: string;
  messageId: string;
  r2Key: string;
  salt: Uint8Array;
  sizeBytes: number;
  ttlAt: Date;
  status: 'PENDING' | 'SIGNED' | 'DELIVERED' | 'EXPIRED';
  createdAt: Date;
}

function fakePrisma(initial: FakeRow[]): PrismaClient {
  const rows = new Map(initial.map((r) => [r.id, r]));
  return {
    pendingPdf: {
      async findUnique({ where }: { where: { id?: string; messageId?: string } }) {
        if (where.id) return rows.get(where.id) ?? null;
        return null;
      },
      async findMany({ where }: { where: { otpHash?: string; status?: string } }) {
        return Array.from(rows.values()).filter(
          (r) =>
            (!where.otpHash || r.otpHash === where.otpHash) &&
            (!where.status || r.status === where.status),
        );
      },
    },
    $disconnect: async () => {},
  } as unknown as PrismaClient;
}

function fakeS3(stored: Map<string, Buffer>): S3Client {
  return {
    send: async (cmd: {
      constructor: { name: string };
      input: { Bucket: string; Key: string };
    }) => {
      if (cmd.constructor.name === 'GetObjectCommand') {
        const buf = stored.get(cmd.input.Key);
        if (!buf) throw new Error('not found');
        return {
          Body: {
            async *[Symbol.asyncIterator]() {
              yield buf;
            },
          },
        };
      }
      throw new Error('unsupported');
    },
    destroy: () => {},
  } as unknown as S3Client;
}

describe('inbox routes', () => {
  let app: FastifyInstance;
  let redis: Redis;
  const env = loadEnv();

  const salt = new Uint8Array(16).fill(7);
  const r2Key = 'r2-key-1.bin';
  const r2Body = Buffer.concat([Buffer.alloc(12, 0xab), Buffer.from('cipher-bytes')]);
  let row: FakeRow;
  let row2: FakeRow;

  beforeEach(async () => {
    const otp = '123456';
    const otpHashed = await hashOtp(otp, env.INBOX_DEPLOY_SECRET);
    row = {
      id: 'pdf-1',
      otpHash: otpHashed,
      senderPhoneHash: 'phHash',
      messageId: 'm1',
      r2Key,
      salt,
      sizeBytes: 1024,
      ttlAt: new Date(Date.now() + 3600_000),
      status: 'PENDING',
      createdAt: new Date(),
    };
    row2 = { ...row, id: 'pdf-2', otpHash: 'OTHER_HASH', messageId: 'm2', r2Key: 'other.bin' };

    const prisma = fakePrisma([row, row2]);
    redis = new RedisMock() as unknown as Redis;
    // Pre-load OTP lookup
    const lookup = otpLookupKey(otp, env.INBOX_DEPLOY_SECRET);
    await redis.set(`otp:${lookup}`, row.id, 'EX', 600);

    const stored = new Map<string, Buffer>();
    stored.set(r2Key, r2Body);

    app = await buildServer({
      env,
      disableRateLimit: true,
      overrides: {
        prisma,
        redis,
        r2Client: fakeS3(stored),
        evolution: {
          axios: {} as never,
          sendText: async () => {},
          getBase64FromMediaMessage: async () => '',
          sendDocument: async () => ({ messageId: 'mock' }),
          findMessageJid: async () => null,
          getConnectionState: async () => ({ state: 'open' }),
        },
        audit: { log: async () => {} },
      },
    });
  });

  it('POST /api/inbox/verify with good OTP returns jwt + items', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/inbox/verify',
      payload: { otp: '123456' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { jwt: string; items: Array<{ id: string; saltB64: string }> };
    expect(body.jwt).toMatch(/^eyJ/);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.id).toBe('pdf-1');
    expect(body.items[0]?.saltB64).toBe(Buffer.from(salt).toString('base64'));
    await app.close();
  });

  it('POST /api/inbox/verify with bad OTP returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/inbox/verify',
      payload: { otp: '999999' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('POST /api/inbox/verify rejects malformed otp body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/inbox/verify',
      payload: { otp: 'abc' },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('GET /api/inbox requires bearer', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/inbox' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('GET /api/inbox returns own rows only', async () => {
    const jwt = await issueJwt(row.otpHash, env.INBOX_JWT_SECRET);
    const res = await app.inject({
      method: 'GET',
      url: '/api/inbox',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json() as Array<{ id: string }>;
    expect(items.map((i) => i.id)).toEqual(['pdf-1']);
    await app.close();
  });

  it('GET /api/inbox/:id/blob streams iv||ciphertext with x-iv-hex', async () => {
    const jwt = await issueJwt(row.otpHash, env.INBOX_JWT_SECRET);
    const res = await app.inject({
      method: 'GET',
      url: '/api/inbox/pdf-1/blob',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-iv-hex']).toBe('ab'.repeat(12));
    expect(res.rawPayload.toString()).toBe('cipher-bytes');
    await app.close();
  });

  it('GET /api/inbox/:id/blob enforces ownership', async () => {
    const jwt = await issueJwt(row.otpHash, env.INBOX_JWT_SECRET);
    const res = await app.inject({
      method: 'GET',
      url: '/api/inbox/pdf-2/blob', // belongs to OTHER_HASH
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET /api/inbox/:id/meta returns saltB64+sizeBytes', async () => {
    const jwt = await issueJwt(row.otpHash, env.INBOX_JWT_SECRET);
    const res = await app.inject({
      method: 'GET',
      url: '/api/inbox/pdf-1/meta',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sizeBytes: number; saltB64: string };
    expect(body.sizeBytes).toBe(1024);
    expect(body.saltB64).toBe(Buffer.from(salt).toString('base64'));
    await app.close();
  });
}, 60_000);
