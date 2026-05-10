/**
 * Integration: /api/outbox/send happy paths and ownership/validation edges.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildTestApp, type TestAppHandles } from '../helpers/buildTestApp.js';
import { hashOtp } from '../../src/services/otp.js';
import { issueJwt } from '../../src/lib/jwt.js';
import { buildMemoryPrisma } from '../helpers/mockPrisma.js';
import { buildMemoryS3 } from '../helpers/mockS3.js';
import { buildMemoryEvolution } from '../helpers/mockEvolution.js';

describe('integration: outbox flow', () => {
  let h: TestAppHandles;
  let otpHash: string;
  let r2Key: string;

  beforeEach(async () => {
    const otp = '654321';
    const prisma = buildMemoryPrisma();
    const s3 = buildMemoryS3();
    const evolution = buildMemoryEvolution({
      jidByMessageId: { 'msg-orig-1': '593989778888@s.whatsapp.net' },
    });
    const { loadEnv } = await import('../../src/env.js');
    const env = loadEnv();
    otpHash = await hashOtp(otp, env.INBOX_DEPLOY_SECRET);
    r2Key = 'r2/outbox.bin';
    prisma.pdfs.set('out-1', {
      id: 'out-1',
      otpHash,
      senderPhoneHash: 'phx',
      messageId: 'msg-orig-1',
      r2Key,
      salt: new Uint8Array(16),
      sizeBytes: 1024,
      ttlAt: new Date(Date.now() + 3_600_000),
      status: 'PENDING',
      createdAt: new Date(),
      consumedAt: null,
      deletedAt: null,
    });
    s3.storage.set(r2Key, Buffer.alloc(64, 0));
    h = await buildTestApp({ prisma, s3, evolution });
  });

  afterEach(async () => {
    await h.app.close();
  });

  it('target=original: sendDocument to resolved JID, status=SENT, R2 deleted', async () => {
    const jwt = await issueJwt(otpHash, h.env.INBOX_JWT_SECRET);
    const signed = Buffer.from('%PDF-signed-bytes-here');
    const res = await h.app.inject({
      method: 'POST', url: '/api/outbox/send',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        id: 'out-1',
        signedPdfB64: signed.toString('base64'),
        target: { kind: 'original' },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(h.evolution.sentDocs).toHaveLength(1);
    expect(h.evolution.sentDocs[0]?.jid).toBe('593989778888@s.whatsapp.net');
    expect(h.evolution.sentDocs[0]?.filename).toBe('firmado.pdf');
    expect(h.prisma.pdfs.get('out-1')?.status).toBe('SENT');
    expect(h.prisma.pdfs.get('out-1')?.consumedAt).toBeInstanceOf(Date);
    expect(h.s3.deleted).toEqual([r2Key]);
  });

  it('target=phone with valid +593 builds JID `<digits>@s.whatsapp.net`', async () => {
    const jwt = await issueJwt(otpHash, h.env.INBOX_JWT_SECRET);
    const res = await h.app.inject({
      method: 'POST', url: '/api/outbox/send',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        id: 'out-1',
        signedPdfB64: Buffer.from('%PDF').toString('base64'),
        target: { kind: 'phone', phone: '+593987654321' },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(h.evolution.sentDocs[0]?.jid).toBe('593987654321@s.whatsapp.net');
  });

  it('target=phone with non-EC number → 422 invalid_phone', async () => {
    const jwt = await issueJwt(otpHash, h.env.INBOX_JWT_SECRET);
    const res = await h.app.inject({
      method: 'POST', url: '/api/outbox/send',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        id: 'out-1',
        signedPdfB64: Buffer.from('%PDF').toString('base64'),
        target: { kind: 'phone', phone: '+12025550000' },
      },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: string }).error).toBe('invalid_phone');
  });

  it('cross-user JWT cannot send another row → 404', async () => {
    const jwt = await issueJwt('SOMEONE-ELSE-HASH', h.env.INBOX_JWT_SECRET);
    const res = await h.app.inject({
      method: 'POST', url: '/api/outbox/send',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        id: 'out-1',
        signedPdfB64: Buffer.from('%PDF').toString('base64'),
        target: { kind: 'original' },
      },
    });
    expect(res.statusCode).toBe(404);
    expect(h.evolution.sentDocs).toHaveLength(0);
    expect(h.prisma.pdfs.get('out-1')?.status).toBe('PENDING');
  });

  it('target=original with unresolvable messageId → 404', async () => {
    // Drop the JID mapping → findMessageJid returns null.
    h.evolution.jidByMessageId.clear();
    const jwt = await issueJwt(otpHash, h.env.INBOX_JWT_SECRET);
    const res = await h.app.inject({
      method: 'POST', url: '/api/outbox/send',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        id: 'out-1',
        signedPdfB64: Buffer.from('%PDF').toString('base64'),
        target: { kind: 'original' },
      },
    });
    expect(res.statusCode).toBe(404);
    expect(h.evolution.sentDocs).toHaveLength(0);
  });

  it('rejects oversized signed PDFs (>25MB) with 422', async () => {
    const jwt = await issueJwt(otpHash, h.env.INBOX_JWT_SECRET);
    const big = Buffer.alloc(26 * 1024 * 1024, 1).toString('base64');
    const res = await h.app.inject({
      method: 'POST', url: '/api/outbox/send',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        id: 'out-1',
        signedPdfB64: big,
        target: { kind: 'original' },
      },
    });
    expect(res.statusCode).toBe(422);
    expect(h.evolution.sentDocs).toHaveLength(0);
  });

  it('caption is forwarded to evolution.sendDocument', async () => {
    const jwt = await issueJwt(otpHash, h.env.INBOX_JWT_SECRET);
    const res = await h.app.inject({
      method: 'POST', url: '/api/outbox/send',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        id: 'out-1',
        signedPdfB64: Buffer.from('%PDF').toString('base64'),
        target: { kind: 'original' },
        caption: 'Hola firmado',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(h.evolution.sentDocs[0]?.caption).toBe('Hola firmado');
  });
}, 60_000);
