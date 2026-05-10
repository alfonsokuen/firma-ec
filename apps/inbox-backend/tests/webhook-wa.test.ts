import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { S3Client } from '@aws-sdk/client-s3';
import type { EvolutionClient } from '../src/plugins/evolution.js';
import { loadEnv } from '../src/env.js';

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

function fakePrisma(): PrismaClient & { _rows: Map<string, FakeRow>; _byMsg: Map<string, string> } {
  const rows = new Map<string, FakeRow>();
  const byMsg = new Map<string, string>();
  let counter = 0;
  return {
    _rows: rows,
    _byMsg: byMsg,
    pendingPdf: {
      async findUnique({ where, select }: { where: { messageId?: string; id?: string }; select?: unknown }) {
        let row: FakeRow | undefined;
        if (where.messageId) {
          const id = byMsg.get(where.messageId);
          if (id) row = rows.get(id);
        } else if (where.id) {
          row = rows.get(where.id);
        }
        return row ?? null;
      },
      async create({ data, select }: { data: Omit<FakeRow, 'id' | 'createdAt'> & { createdAt?: Date }; select?: unknown }) {
        counter++;
        const id = `pdf-${counter}`;
        const row: FakeRow = {
          id,
          otpHash: data.otpHash,
          senderPhoneHash: data.senderPhoneHash,
          messageId: data.messageId,
          r2Key: data.r2Key,
          salt: data.salt instanceof Buffer ? new Uint8Array(data.salt) : (data.salt as Uint8Array),
          sizeBytes: data.sizeBytes,
          ttlAt: data.ttlAt,
          status: data.status ?? 'PENDING',
          createdAt: new Date(),
        };
        rows.set(id, row);
        byMsg.set(row.messageId, id);
        return { id };
      },
      async findMany({ where }: { where: { otpHash?: string; status?: string } }) {
        return Array.from(rows.values())
          .filter((r) => (!where.otpHash || r.otpHash === where.otpHash) && (!where.status || r.status === where.status));
      },
    },
    $disconnect: async () => {},
  } as unknown as PrismaClient & { _rows: Map<string, FakeRow>; _byMsg: Map<string, string> };
}

function fakeS3(): { client: S3Client; storage: Map<string, Buffer> } {
  const storage = new Map<string, Buffer>();
  const client = {
    send: async (cmd: { constructor: { name: string }; input: { Bucket: string; Key: string; Body?: Buffer } }) => {
      const cls = cmd.constructor.name;
      if (cls === 'PutObjectCommand') {
        const body = cmd.input.Body;
        if (!body) throw new Error('no body');
        storage.set(cmd.input.Key, Buffer.isBuffer(body) ? body : Buffer.from(body));
        return {};
      }
      if (cls === 'GetObjectCommand') {
        const buf = storage.get(cmd.input.Key);
        if (!buf) throw new Error('not found');
        return { Body: bufferToStream(buf) };
      }
      throw new Error(`unsupported ${cls}`);
    },
    destroy: () => {},
  } as unknown as S3Client;
  return { client, storage };
}

function bufferToStream(buf: Buffer): AsyncIterable<Buffer> {
  return {
    async *[Symbol.asyncIterator]() {
      yield buf;
    },
  };
}

function fakeEvolution(): EvolutionClient & { sent: { jid: string; text: string }[]; pdfBase64: string } {
  const obj = {
    sent: [] as { jid: string; text: string }[],
    pdfBase64: '',
    axios: {} as never,
    async sendText(jid: string, text: string) {
      this.sent.push({ jid, text });
    },
    async getBase64FromMediaMessage() {
      return this.pdfBase64;
    },
  };
  return obj as EvolutionClient & { sent: { jid: string; text: string }[]; pdfBase64: string };
}

function signBody(body: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function makePayload(messageId = 'msg-1') {
  return {
    event: 'messages.upsert',
    data: {
      key: { id: messageId, remoteJid: '593989778888@s.whatsapp.net', fromMe: false },
      message: {
        documentMessage: {
          mimetype: 'application/pdf',
          fileLength: 1024,
        },
      },
    },
  };
}

describe('POST /webhook/wa', () => {
  let app: FastifyInstance;
  let prisma: ReturnType<typeof fakePrisma>;
  let redis: Redis;
  let r2: ReturnType<typeof fakeS3>;
  let evo: ReturnType<typeof fakeEvolution>;
  const env = loadEnv();

  beforeEach(async () => {
    prisma = fakePrisma();
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
    r2 = fakeS3();
    evo = fakeEvolution();
    // Tiny PDF stub (4 bytes) base64
    evo.pdfBase64 = Buffer.from('%PDF').toString('base64');
    app = await buildServer({
      env,
      disableRateLimit: true,
      overrides: {
        prisma,
        redis,
        r2Client: r2.client,
        evolution: evo,
      },
    });
  });

  it('rejects bad HMAC with 401', async () => {
    const body = Buffer.from(JSON.stringify(makePayload()));
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/wa',
      headers: { 'content-type': 'application/json', 'x-evolution-signature': 'deadbeef' },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    const json = res.json() as { error: string };
    expect(json.error).toBe('bad_hmac');
    await app.close();
  });

  it('happy path stores row, uploads to R2, sends WA reply', async () => {
    const body = Buffer.from(JSON.stringify(makePayload('msg-happy')));
    const sig = signBody(body, env.WEBHOOK_HMAC_SECRET);
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/wa',
      headers: { 'content-type': 'application/json', 'x-evolution-signature': sig },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(prisma._rows.size).toBe(1);
    expect(r2.storage.size).toBe(1);
    expect(evo.sent.length).toBe(1);
    expect(evo.sent[0]?.text).toMatch(/firmar\.ec\/inbox\?t=\d{6}/);
    await app.close();
  });

  it('replays return 200 noop without duplicating', async () => {
    const body = Buffer.from(JSON.stringify(makePayload('msg-dup')));
    const sig = signBody(body, env.WEBHOOK_HMAC_SECRET);
    const r1 = await app.inject({ method: 'POST', url: '/webhook/wa', headers: { 'content-type': 'application/json', 'x-evolution-signature': sig }, payload: body });
    expect(r1.statusCode).toBe(200);
    const r2 = await app.inject({ method: 'POST', url: '/webhook/wa', headers: { 'content-type': 'application/json', 'x-evolution-signature': sig }, payload: body });
    expect(r2.statusCode).toBe(200);
    expect(prisma._rows.size).toBe(1);
    await app.close();
  });

  it('ignores non-PDF messages with 200', async () => {
    const payload = {
      event: 'messages.upsert',
      data: {
        key: { id: 'm-text', remoteJid: '593989778888@s.whatsapp.net' },
        message: { conversation: 'hola' },
      },
    };
    const body = Buffer.from(JSON.stringify(payload));
    const sig = signBody(body, env.WEBHOOK_HMAC_SECRET);
    const res = await app.inject({ method: 'POST', url: '/webhook/wa', headers: { 'content-type': 'application/json', 'x-evolution-signature': sig }, payload: body });
    expect(res.statusCode).toBe(200);
    expect(prisma._rows.size).toBe(0);
    await app.close();
  });

  it('rejects PDFs > 20MB', async () => {
    const payload = makePayload('m-big');
    payload.data.message.documentMessage.fileLength = 30 * 1024 * 1024;
    const body = Buffer.from(JSON.stringify(payload));
    const sig = signBody(body, env.WEBHOOK_HMAC_SECRET);
    const res = await app.inject({ method: 'POST', url: '/webhook/wa', headers: { 'content-type': 'application/json', 'x-evolution-signature': sig }, payload: body });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
}, 60_000);
