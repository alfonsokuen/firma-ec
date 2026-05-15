import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';
import { issueJwt } from '../src/lib/jwt.js';
import type { EvolutionClient } from '../src/plugins/evolution.js';
import { buildServer } from '../src/server.js';
import { hashOtp } from '../src/services/otp.js';

interface Row {
  id: string;
  otpHash: string;
  senderPhoneHash: string;
  messageId: string;
  r2Key: string;
  salt: Uint8Array;
  sizeBytes: number;
  ttlAt: Date;
  status: string;
  createdAt: Date;
  consumedAt?: Date;
}

function fakePrisma(initial: Row[]): { prisma: PrismaClient; rows: Map<string, Row> } {
  const rows = new Map(initial.map((r) => [r.id, { ...r }]));
  const prisma = {
    $disconnect: async () => {},
    pendingPdf: {
      async findUnique({ where }: { where: { id?: string } }) {
        if (where.id) return rows.get(where.id) ?? null;
        return null;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<Row> }) {
        const r = rows.get(where.id);
        if (!r) throw new Error('not found');
        Object.assign(r, data);
        return r;
      },
    },
  } as unknown as PrismaClient;
  return { prisma, rows };
}

function fakeS3(): { client: S3Client; deleted: string[] } {
  const deleted: string[] = [];
  const client = {
    send: async (cmd: { constructor: { name: string }; input: { Key: string } }) => {
      if (cmd.constructor.name === 'DeleteObjectCommand') {
        deleted.push(cmd.input.Key);
        return {};
      }
      throw new Error('unsupported');
    },
    destroy: () => {},
  } as unknown as S3Client;
  return { client, deleted };
}

function fakeEvo(opts: { jidForMsg?: Record<string, string> } = {}): EvolutionClient & {
  sentDocs: Array<{ jid: string; bytes: Uint8Array; filename: string; caption?: string }>;
} {
  const evo = {
    axios: {} as never,
    sentDocs: [] as Array<{ jid: string; bytes: Uint8Array; filename: string; caption?: string }>,
    async sendText() {},
    async getBase64FromMediaMessage() {
      return '';
    },
    async sendDocument(jid: string, bytes: Uint8Array, filename: string, caption?: string) {
      const entry: { jid: string; bytes: Uint8Array; filename: string; caption?: string } = {
        jid,
        bytes,
        filename,
      };
      if (caption !== undefined) entry.caption = caption;
      this.sentDocs.push(entry);
      return { messageId: 'evo-out-1' };
    },
    async findMessageJid(messageId: string) {
      return opts.jidForMsg?.[messageId] ?? null;
    },
    async getConnectionState() {
      return { state: 'open' };
    },
  };
  return evo as EvolutionClient & { sentDocs: typeof evo.sentDocs };
}

describe('POST /api/outbox/send', () => {
  let app: FastifyInstance;
  let redis: Redis;
  let row: Row;
  let prismaH: { prisma: PrismaClient; rows: Map<string, Row> };
  let s3H: { client: S3Client; deleted: string[] };
  let evo: ReturnType<typeof fakeEvo>;
  const env = loadEnv();

  beforeEach(async () => {
    const otp = '654321';
    const otpHashed = await hashOtp(otp, env.INBOX_DEPLOY_SECRET);
    row = {
      id: 'pdf-1',
      otpHash: otpHashed,
      senderPhoneHash: 'ph',
      messageId: 'wa-msg-orig',
      r2Key: 'r2/pdf-1.bin',
      salt: new Uint8Array(16),
      sizeBytes: 1024,
      ttlAt: new Date(Date.now() + 3600_000),
      status: 'PENDING',
      createdAt: new Date(),
    };
    prismaH = fakePrisma([row]);
    s3H = fakeS3();
    redis = new RedisMock() as unknown as Redis;
    evo = fakeEvo({ jidForMsg: { 'wa-msg-orig': '593989778888@s.whatsapp.net' } });
    app = await buildServer({
      env,
      disableRateLimit: true,
      overrides: {
        prisma: prismaH.prisma,
        redis,
        r2Client: s3H.client,
        evolution: evo,
        audit: { log: async () => {} },
      },
    });
  });

  it('happy path: target=original sends, marks SENT, deletes R2', async () => {
    const jwt = await issueJwt(row.otpHash, env.INBOX_JWT_SECRET);
    const pdf = Buffer.from('%PDF-signed-bytes');
    const res = await app.inject({
      method: 'POST',
      url: '/api/outbox/send',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        id: row.id,
        signedPdfB64: pdf.toString('base64'),
        target: { kind: 'original' },
        caption: 'Documento firmado',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; evolutionMessageId: string };
    expect(body.ok).toBe(true);
    expect(body.evolutionMessageId).toBe('evo-out-1');
    expect(evo.sentDocs).toHaveLength(1);
    expect(evo.sentDocs[0]?.jid).toBe('593989778888@s.whatsapp.net');
    expect(evo.sentDocs[0]?.filename).toBe('firmado.pdf');
    expect(prismaH.rows.get(row.id)?.status).toBe('SENT');
    expect(prismaH.rows.get(row.id)?.consumedAt).toBeInstanceOf(Date);
    expect(s3H.deleted).toEqual([row.r2Key]);
    await app.close();
  });

  it('target=phone with valid +593 builds JID correctly', async () => {
    const jwt = await issueJwt(row.otpHash, env.INBOX_JWT_SECRET);
    const res = await app.inject({
      method: 'POST',
      url: '/api/outbox/send',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        id: row.id,
        signedPdfB64: Buffer.from('%PDF').toString('base64'),
        target: { kind: 'phone', phone: '+593989778888' },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(evo.sentDocs[0]?.jid).toBe('593989778888@s.whatsapp.net');
    await app.close();
  });

  it('target=phone with non-EC number → 422 invalid_phone', async () => {
    const jwt = await issueJwt(row.otpHash, env.INBOX_JWT_SECRET);
    const res = await app.inject({
      method: 'POST',
      url: '/api/outbox/send',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        id: row.id,
        signedPdfB64: Buffer.from('%PDF').toString('base64'),
        target: { kind: 'phone', phone: '+12025550000' },
      },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: string }).error).toBe('invalid_phone');
    await app.close();
  });

  it('cross-user ownership: different otpHash → 404', async () => {
    const jwt = await issueJwt('NOT-THE-OWNER-HASH', env.INBOX_JWT_SECRET);
    const res = await app.inject({
      method: 'POST',
      url: '/api/outbox/send',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        id: row.id,
        signedPdfB64: Buffer.from('%PDF').toString('base64'),
        target: { kind: 'original' },
      },
    });
    expect(res.statusCode).toBe(404);
    expect(evo.sentDocs).toHaveLength(0);
    expect(prismaH.rows.get(row.id)?.status).toBe('PENDING');
    await app.close();
  });

  it('missing auth → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/outbox/send',
      payload: {
        id: row.id,
        signedPdfB64: Buffer.from('x').toString('base64'),
        target: { kind: 'original' },
      },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects oversized signed PDFs (>25MB)', async () => {
    const jwt = await issueJwt(row.otpHash, env.INBOX_JWT_SECRET);
    const big = Buffer.alloc(26 * 1024 * 1024, 1).toString('base64');
    const res = await app.inject({
      method: 'POST',
      url: '/api/outbox/send',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        id: row.id,
        signedPdfB64: big,
        target: { kind: 'original' },
      },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('target=original with unresolvable messageId → 404', async () => {
    evo = fakeEvo({ jidForMsg: {} });
    // Rebuild app with new evo
    await app.close();
    app = await buildServer({
      env,
      disableRateLimit: true,
      overrides: {
        prisma: prismaH.prisma,
        redis,
        r2Client: s3H.client,
        evolution: evo,
        audit: { log: async () => {} },
      },
    });
    const jwt = await issueJwt(row.otpHash, env.INBOX_JWT_SECRET);
    const res = await app.inject({
      method: 'POST',
      url: '/api/outbox/send',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        id: row.id,
        signedPdfB64: Buffer.from('%PDF').toString('base64'),
        target: { kind: 'original' },
      },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
}, 60_000);
