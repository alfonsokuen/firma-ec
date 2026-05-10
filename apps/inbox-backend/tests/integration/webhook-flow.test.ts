/**
 * Integration: full webhook → encrypt → R2 → DB → WA-reply happy path,
 * plus all known short-circuit branches (HMAC, replay, rate-limit, oversize,
 * non-PDF, missing key).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { buildTestApp, makeWebhookPayload, signWebhookBody, type TestAppHandles } from '../helpers/buildTestApp.js';

describe('integration: webhook flow', () => {
  let h: TestAppHandles;

  beforeEach(async () => {
    h = await buildTestApp();
    h.evolution.pdfBase64 = Buffer.from('%PDF-1.7 hello world').toString('base64');
  });

  afterEach(async () => {
    await h.app.close();
  });

  it('happy path: HMAC ok → encrypt → R2 PUT → DB row → WA reply', async () => {
    const payload = makeWebhookPayload({ messageId: 'wa-happy-1' });
    const body = Buffer.from(JSON.stringify(payload));
    const sig = signWebhookBody(body, h.env.WEBHOOK_HMAC_SECRET);

    const res = await h.app.inject({
      method: 'POST',
      url: '/webhook/wa',
      headers: { 'content-type': 'application/json', 'x-evolution-signature': sig },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    // DB
    expect(h.prisma.pdfs.size).toBe(1);
    const row = [...h.prisma.pdfs.values()][0];
    expect(row).toBeDefined();
    expect(row?.messageId).toBe('wa-happy-1');
    expect(row?.otpHash).toMatch(/^\$argon2id\$/);
    expect(row?.senderPhoneHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.r2Key).toMatch(/\.bin$/);
    expect(row?.status).toBe('PENDING');

    // R2
    expect(h.s3.puts).toHaveLength(1);
    expect(h.s3.puts[0]?.key).toBe(row?.r2Key);
    // R2 body = iv (12B) || ciphertext+tag — never the plaintext PDF.
    const stored = h.s3.puts[0]?.body;
    expect(stored).toBeInstanceOf(Buffer);
    expect((stored as Buffer).indexOf(Buffer.from('%PDF-1.7'))).toBe(-1);

    // Evolution: 1 base64 fetch + 1 sendText.
    expect(h.evolution.fetchCalls).toBe(1);
    expect(h.evolution.sentTexts).toHaveLength(1);
    expect(h.evolution.sentTexts[0]?.text).toMatch(/firmar\.ec/);
    expect(h.evolution.sentTexts[0]?.text).toMatch(/\d{6}/); // OTP visible in WA
  });

  it('rejects bad HMAC with 401', async () => {
    const body = Buffer.from(JSON.stringify(makeWebhookPayload({ messageId: 'wa-bad' })));
    const res = await h.app.inject({
      method: 'POST',
      url: '/webhook/wa',
      headers: { 'content-type': 'application/json', 'x-evolution-signature': 'deadbeef' },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    expect(h.prisma.pdfs.size).toBe(0);
    expect(h.s3.puts).toHaveLength(0);
  });

  it('replay (same messageId twice) returns 200 noop without duplicating', async () => {
    const body = Buffer.from(JSON.stringify(makeWebhookPayload({ messageId: 'wa-replay' })));
    const sig = signWebhookBody(body, h.env.WEBHOOK_HMAC_SECRET);
    const r1 = await h.app.inject({
      method: 'POST', url: '/webhook/wa',
      headers: { 'content-type': 'application/json', 'x-evolution-signature': sig },
      payload: body,
    });
    expect(r1.statusCode).toBe(200);
    expect(h.prisma.pdfs.size).toBe(1);
    expect(h.s3.puts).toHaveLength(1);

    const r2 = await h.app.inject({
      method: 'POST', url: '/webhook/wa',
      headers: { 'content-type': 'application/json', 'x-evolution-signature': sig },
      payload: body,
    });
    expect(r2.statusCode).toBe(200);
    expect((r2.json() as { ignored?: string }).ignored).toBe('duplicate');
    expect(h.prisma.pdfs.size).toBe(1);
    expect(h.s3.puts).toHaveLength(1); // no second upload
  });

  it('rate-limits 2nd message from same phone within 30s (msgPerPhone)', async () => {
    // capacity=1, refill=1/30s — second msg same phone burns the bucket.
    const p1 = makeWebhookPayload({ messageId: 'wa-rl-1' });
    const p2 = makeWebhookPayload({ messageId: 'wa-rl-2' });
    const b1 = Buffer.from(JSON.stringify(p1));
    const b2 = Buffer.from(JSON.stringify(p2));
    const headers1 = { 'content-type': 'application/json', 'x-evolution-signature': signWebhookBody(b1, h.env.WEBHOOK_HMAC_SECRET) };
    const headers2 = { 'content-type': 'application/json', 'x-evolution-signature': signWebhookBody(b2, h.env.WEBHOOK_HMAC_SECRET) };

    const r1 = await h.app.inject({ method: 'POST', url: '/webhook/wa', headers: headers1, payload: b1 });
    expect(r1.statusCode).toBe(200);
    const r2 = await h.app.inject({ method: 'POST', url: '/webhook/wa', headers: headers2, payload: b2 });
    expect(r2.statusCode).toBe(429);
  });

  it('rate-limits 6th PDF from same phone in a day (pdfPerDay)', async () => {
    // Use distinct phones for first hit each? — no, we want same phone but msg-bucket
    // fully depleted only resets after 30s. Strategy: clear the msg bucket between
    // requests by manipulating the redis key directly.
    const phoneJid = '593987111222@s.whatsapp.net';
    for (let i = 1; i <= 6; i++) {
      // Reset the per-msg bucket so we only test the per-day bucket.
      const keys = await h.redis.keys('rl:msg:*');
      if (keys.length > 0) await h.redis.del(...keys);
      const payload = makeWebhookPayload({ messageId: `wa-day-${String(i)}`, remoteJid: phoneJid });
      const body = Buffer.from(JSON.stringify(payload));
      const sig = signWebhookBody(body, h.env.WEBHOOK_HMAC_SECRET);
      const res = await h.app.inject({
        method: 'POST', url: '/webhook/wa',
        headers: { 'content-type': 'application/json', 'x-evolution-signature': sig },
        payload: body,
      });
      if (i <= 5) {
        expect(res.statusCode, `attempt ${String(i)}`).toBe(200);
      } else {
        expect(res.statusCode).toBe(429);
      }
    }
  }, 30_000);

  it('rejects PDFs with announced size > 20MB and notifies sender', async () => {
    const payload = makeWebhookPayload({ messageId: 'wa-big', fileLength: 30 * 1024 * 1024 });
    const body = Buffer.from(JSON.stringify(payload));
    const sig = signWebhookBody(body, h.env.WEBHOOK_HMAC_SECRET);
    const res = await h.app.inject({
      method: 'POST', url: '/webhook/wa',
      headers: { 'content-type': 'application/json', 'x-evolution-signature': sig },
      payload: body,
    });
    expect(res.statusCode).toBe(422);
    // Sender was notified.
    expect(h.evolution.sentTexts).toHaveLength(1);
    expect(h.evolution.sentTexts[0]?.text).toMatch(/20MB/);
    // Nothing persisted.
    expect(h.prisma.pdfs.size).toBe(0);
    expect(h.s3.puts).toHaveLength(0);
  });

  it('non-PDF document is ignored with 200', async () => {
    const payload = {
      event: 'messages.upsert',
      data: {
        key: { id: 'wa-text', remoteJid: '593989778888@s.whatsapp.net', fromMe: false },
        message: { conversation: 'hola' },
      },
    };
    const body = Buffer.from(JSON.stringify(payload));
    const sig = signWebhookBody(body, h.env.WEBHOOK_HMAC_SECRET);
    const res = await h.app.inject({
      method: 'POST', url: '/webhook/wa',
      headers: { 'content-type': 'application/json', 'x-evolution-signature': sig },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ignored?: string }).ignored).toBe('no_pdf');
    expect(h.prisma.pdfs.size).toBe(0);
  });

  it('missing key.id or remoteJid → 200 ignored', async () => {
    const payload = {
      event: 'messages.upsert',
      data: {
        key: {},
        message: { documentMessage: { mimetype: 'application/pdf', fileLength: 100 } },
      },
    };
    const body = Buffer.from(JSON.stringify(payload));
    const sig = signWebhookBody(body, h.env.WEBHOOK_HMAC_SECRET);
    const res = await h.app.inject({
      method: 'POST', url: '/webhook/wa',
      headers: { 'content-type': 'application/json', 'x-evolution-signature': sig },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ignored?: string }).ignored).toBe('no_key');
  });

  it('non-messages.upsert event → 200 ignored', async () => {
    const payload = { event: 'connection.update', data: {} };
    const body = Buffer.from(JSON.stringify(payload));
    const sig = signWebhookBody(body, h.env.WEBHOOK_HMAC_SECRET);
    const res = await h.app.inject({
      method: 'POST', url: '/webhook/wa',
      headers: { 'content-type': 'application/json', 'x-evolution-signature': sig },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ignored?: string }).ignored).toBe('event');
  });

  it('fromMe=true → 200 ignored (do not echo our own outbox)', async () => {
    const payload = makeWebhookPayload({ messageId: 'wa-fromme', fromMe: true });
    const body = Buffer.from(JSON.stringify(payload));
    const sig = signWebhookBody(body, h.env.WEBHOOK_HMAC_SECRET);
    const res = await h.app.inject({
      method: 'POST', url: '/webhook/wa',
      headers: { 'content-type': 'application/json', 'x-evolution-signature': sig },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ignored?: string }).ignored).toBe('from_me');
  });
}, 60_000);

// keep linter happy (RedisMock import is needed indirectly when buildTestApp
// is overridden)
void RedisMock;
void ((): Redis | undefined => undefined);
