/**
 * Privacy invariants (F3.5 §4 threat model).
 *
 * After a full happy-path run we assert the **physical bytes** that hit each
 * sink contain no plaintext markers:
 *   - R2 stored bytes: no `%PDF-` header, no plaintext marker.
 *   - DB `PendingPdf`: otpHash is argon2 (not literal OTP), senderPhoneHash
 *     is hex (not literal phone number).
 *   - DB `AuditLog.payloadCiphertext`: AES-GCM envelope, contains none of the
 *     PII bytes.
 *   - Pino logs (captured from stdout): no plaintext OTP, no phone, no PDF
 *     marker. Hashes are allowed.
 *
 * The test also round-trips through `decryptFromR2` to prove the marker is
 * recoverable client-side with the same OTP+salt the user receives via WA.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { decryptFromR2 } from '@firma-ec/inbox-crypto';
import { buildTestApp, makeWebhookPayload, signWebhookBody, type TestAppHandles } from '../helpers/buildTestApp.js';

const PLAINTEXT_MARKER = 'KNOWN_PLAINTEXT_MARKER_91824';
const PHONE_RAW = '+593987123456';
const PHONE_JID = '593987123456@s.whatsapp.net';

function buildPdfFixture(): Buffer {
  // Fixture: well-formed enough to look like a PDF (header + marker + EOF).
  return Buffer.concat([
    Buffer.from('%PDF-1.7\n'),
    Buffer.alloc(100, 0x20),
    Buffer.from(PLAINTEXT_MARKER, 'utf8'),
    Buffer.alloc(50, 0x20),
    Buffer.from('\n%%EOF\n'),
  ]);
}

function bytesContain(haystack: Buffer | Uint8Array, needle: string): boolean {
  return Buffer.from(haystack).indexOf(Buffer.from(needle, 'utf8')) !== -1;
}

describe('integration: privacy invariants', () => {
  let h: TestAppHandles;
  // Capture stdout writes from pino.
  const stdoutChunks: Buffer[] = [];
  let stdoutSpy: ReturnType<typeof vi.spyOn> | undefined;

  afterEach(async () => {
    if (h?.app) await h.app.close();
    if (stdoutSpy) {
      stdoutSpy.mockRestore();
      stdoutSpy = undefined;
    }
    stdoutChunks.length = 0;
  });

  it('plaintext PDF/OTP/phone never reach R2, DB columns, audit blob, or logs', async () => {
    // Begin spying BEFORE building the server so all pino output is captured.
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((
      chunk: string | Uint8Array,
      ..._rest: unknown[]
    ) => {
      stdoutChunks.push(
        typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    const fixture = buildPdfFixture();
    h = await buildTestApp();
    h.evolution.pdfBase64 = fixture.toString('base64');

    // 1. Webhook ingest.
    const payload = makeWebhookPayload({
      messageId: 'priv-1',
      remoteJid: PHONE_JID,
    });
    const body = Buffer.from(JSON.stringify(payload));
    const sig = signWebhookBody(body, h.env.WEBHOOK_HMAC_SECRET);
    const r = await h.app.inject({
      method: 'POST', url: '/webhook/wa',
      headers: { 'content-type': 'application/json', 'x-evolution-signature': sig },
      payload: body,
    });
    expect(r.statusCode).toBe(200);
    expect(h.prisma.pdfs.size).toBe(1);

    // Capture OTP from the WA reply (the only place plaintext OTP exists).
    const reply = h.evolution.sentTexts[0]?.text ?? '';
    const otpMatch = reply.match(/\b(\d{6})\b/);
    expect(otpMatch).toBeTruthy();
    const otp = otpMatch?.[1] ?? '';

    // 2. Round-trip prove encryption is reversible (the *user* path).
    const row = [...h.prisma.pdfs.values()][0];
    expect(row).toBeDefined();
    const stored = h.s3.storage.get(row?.r2Key ?? '');
    expect(stored).toBeInstanceOf(Buffer);
    const iv = (stored as Buffer).subarray(0, 12);
    const ciphertext = (stored as Buffer).subarray(12);
    const decrypted = await decryptFromR2(
      otp,
      new Uint8Array(row?.salt as Uint8Array),
      new Uint8Array(iv),
      new Uint8Array(ciphertext),
    );
    expect(bytesContain(Buffer.from(decrypted), PLAINTEXT_MARKER)).toBe(true);
    expect(bytesContain(Buffer.from(decrypted), '%PDF-')).toBe(true);

    // ────────────────────────────────────────────────────────────────────
    // PRIVACY ASSERTIONS — none of the sinks may carry the plaintext bytes
    // ────────────────────────────────────────────────────────────────────

    // (a) R2 stored bytes: no PDF header, no marker.
    for (const put of h.s3.puts) {
      expect(bytesContain(put.body, '%PDF-'), 'R2 PUT must not contain %PDF- header').toBe(false);
      expect(bytesContain(put.body, PLAINTEXT_MARKER), 'R2 PUT must not contain plaintext marker').toBe(false);
    }

    // (b) PendingPdf row: otpHash is argon2 (not literal OTP), phone hash is hex.
    expect(row?.otpHash).toMatch(/^\$argon2id\$/);
    expect(row?.otpHash.includes(otp)).toBe(false);
    expect(row?.senderPhoneHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.senderPhoneHash.includes('593987123456')).toBe(false);
    // No row column carries the marker, the phone, or the OTP.
    const rowAsString = JSON.stringify({
      ...row,
      salt: Buffer.from(row?.salt ?? new Uint8Array()).toString('base64'),
    });
    expect(rowAsString.includes(PLAINTEXT_MARKER)).toBe(false);
    expect(rowAsString.includes(PHONE_RAW)).toBe(false);
    expect(rowAsString.includes('593987123456')).toBe(false);
    expect(rowAsString.includes(otp)).toBe(false);

    // (c) AuditLog payloadCiphertext: encrypted blob, none of the PII bytes.
    expect(h.prisma.audits.length).toBeGreaterThan(0);
    for (const a of h.prisma.audits) {
      expect(bytesContain(a.payloadCiphertext, '593987123456')).toBe(false);
      expect(bytesContain(a.payloadCiphertext, otp)).toBe(false);
      expect(bytesContain(a.payloadCiphertext, PLAINTEXT_MARKER)).toBe(false);
    }

    // (d) Pino logs (captured stdout): no PII bytes. Hashes ARE allowed.
    const logBlob = Buffer.concat(stdoutChunks).toString('utf8');
    expect(logBlob.length).toBeGreaterThan(0); // we did capture *something*
    expect(logBlob.includes('593987123456'), 'log must not include raw phone digits').toBe(false);
    expect(logBlob.includes(PHONE_RAW), 'log must not include +593 phone').toBe(false);
    expect(logBlob.includes(otp), 'log must not include literal OTP').toBe(false);
    expect(logBlob.includes(PLAINTEXT_MARKER), 'log must not include plaintext marker').toBe(false);
    expect(logBlob.includes('%PDF-'), 'log must not include PDF header').toBe(false);
  }, 30_000);

  it('senderPhoneHash is deterministic across two ingests from same phone', async () => {
    h = await buildTestApp();
    h.evolution.pdfBase64 = Buffer.from('%PDF-1.7 a').toString('base64');
    const send = async (id: string): Promise<void> => {
      const body = Buffer.from(JSON.stringify(makeWebhookPayload({ messageId: id, remoteJid: PHONE_JID })));
      const sig = signWebhookBody(body, h.env.WEBHOOK_HMAC_SECRET);
      // Reset msg-bucket between sends.
      const keys = await h.redis.keys('rl:msg:*');
      if (keys.length > 0) await h.redis.del(...keys);
      await h.app.inject({
        method: 'POST', url: '/webhook/wa',
        headers: { 'content-type': 'application/json', 'x-evolution-signature': sig },
        payload: body,
      });
    };
    await send('priv-det-1');
    await send('priv-det-2');
    const rows = [...h.prisma.pdfs.values()];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.senderPhoneHash).toBe(rows[1]?.senderPhoneHash);
    // But each row has a unique r2Key + unique salt (no derived-key reuse).
    expect(rows[0]?.r2Key).not.toBe(rows[1]?.r2Key);
    expect(Buffer.from(rows[0]?.salt ?? new Uint8Array()).equals(
      Buffer.from(rows[1]?.salt ?? new Uint8Array()),
    )).toBe(false);
  }, 30_000);

  it('encrypted R2 bytes for the same plaintext under different OTPs differ', async () => {
    h = await buildTestApp();
    const fixture = buildPdfFixture();
    h.evolution.pdfBase64 = fixture.toString('base64');
    const send = async (id: string, jid: string): Promise<void> => {
      const body = Buffer.from(JSON.stringify(makeWebhookPayload({ messageId: id, remoteJid: jid })));
      const sig = signWebhookBody(body, h.env.WEBHOOK_HMAC_SECRET);
      const keys = await h.redis.keys('rl:msg:*');
      if (keys.length > 0) await h.redis.del(...keys);
      await h.app.inject({
        method: 'POST', url: '/webhook/wa',
        headers: { 'content-type': 'application/json', 'x-evolution-signature': sig },
        payload: body,
      });
    };
    await send('priv-iv-1', '593987111111@s.whatsapp.net');
    await send('priv-iv-2', '593987222222@s.whatsapp.net');
    expect(h.s3.puts).toHaveLength(2);
    // Different IV (random) AND different derived key → ciphertexts differ.
    expect(Buffer.compare(h.s3.puts[0]!.body, h.s3.puts[1]!.body)).not.toBe(0);
    // Both must be at least IV(12) + tag(16) bytes.
    expect(h.s3.puts[0]!.body.length).toBeGreaterThan(28);
    expect(h.s3.puts[1]!.body.length).toBeGreaterThan(28);
  }, 30_000);
});
