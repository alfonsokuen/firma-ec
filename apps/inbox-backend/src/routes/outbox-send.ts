/**
 * POST /api/outbox/send — deliver a signed PDF back over WhatsApp.
 *
 * Flow:
 *  1. JWT auth → req.inboxAuth.otpHash (Capa 2 ownership).
 *  2. Lookup PendingPdf by id; ownership = otpHash match (404 otherwise).
 *  3. Resolve target JID:
 *      - 'original': use evolution.findMessageJid(row.messageId).
 *      - 'phone':    validate +593 E.164 and format `<digits>@s.whatsapp.net`.
 *  4. base64 decode + size guard (≤ 25MB).
 *  5. evolution.sendDocument(...).
 *  6. Mark row status='SENT', consumedAt=now, delete from R2 (best-effort).
 *  7. audit.log('outbox.sent', { pdfId, target:<masked>, evolutionMessageId, sizeBytes }).
 */
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../env.js';
import { requireJwt } from '../lib/auth.js';
import { InboxError } from '../lib/errors.js';
import { maskPhone, normalizePhoneEC } from '../lib/phone-hash.js';

const MAX_SIGNED_BYTES = 25 * 1024 * 1024;

const TargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('original') }),
  z.object({ kind: z.literal('phone'), phone: z.string().min(4) }),
]);

const BodySchema = z.object({
  id: z.string().min(1),
  signedPdfB64: z.string().min(1),
  target: TargetSchema,
  caption: z.string().max(1024).optional(),
});

export interface OutboxRoutesOpts {
  env: Env;
}

export default async function outboxRoutes(
  app: FastifyInstance,
  opts: OutboxRoutesOpts,
): Promise<void> {
  const { env } = opts;
  const auth = requireJwt(env.INBOX_JWT_SECRET);

  app.post('/api/outbox/send', { preHandler: auth }, async (req, reply) => {
    const otpHash = req.inboxAuth?.otpHash;
    if (!otpHash) throw new InboxError('unauthorized');

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new InboxError('invalid_input', parsed.error.issues[0]?.message ?? 'bad body');
    }
    const { id, signedPdfB64, target, caption } = parsed.data;

    // 1. Lookup + ownership.
    const row = await app.prisma.pendingPdf.findUnique({
      where: { id },
      select: {
        id: true,
        otpHash: true,
        messageId: true,
        r2Key: true,
        status: true,
      },
    });
    if (!row || row.otpHash !== otpHash) {
      throw new InboxError('not_found', 'pdf no longer available');
    }

    // 2. Resolve target JID.
    let targetJid: string;
    let maskedTarget: string;
    if (target.kind === 'original') {
      const jid = await app.evolution.findMessageJid(row.messageId);
      if (!jid) {
        throw new InboxError('not_found', 'original conversation not resolvable');
      }
      targetJid = jid;
      maskedTarget = 'original';
    } else {
      let normalized: string;
      try {
        normalized = normalizePhoneEC(target.phone);
      } catch {
        throw new InboxError('invalid_phone', 'phone must be +593 E.164');
      }
      const digits = normalized.replace(/^\+/, '');
      targetJid = `${digits}@s.whatsapp.net`;
      maskedTarget = maskPhone(normalized);
    }

    // 3. Decode + size guard.
    let bytes: Buffer;
    try {
      bytes = Buffer.from(signedPdfB64, 'base64');
    } catch {
      throw new InboxError('invalid_input', 'signedPdfB64 not base64');
    }
    if (bytes.byteLength === 0) {
      throw new InboxError('invalid_input', 'signedPdfB64 empty');
    }
    if (bytes.byteLength > MAX_SIGNED_BYTES) {
      throw new InboxError('pdf_too_large', 'signed pdf exceeds 25MB');
    }

    // 4. Send via Evolution.
    const filename = 'firmado.pdf';
    const sendOpts = caption !== undefined ? caption : undefined;
    const { messageId: evolutionMessageId } = await app.evolution.sendDocument(
      targetJid,
      new Uint8Array(bytes),
      filename,
      sendOpts,
    );

    // 5. Mark consumed.
    await app.prisma.pendingPdf.update({
      where: { id: row.id },
      data: {
        status: 'SENT',
        consumedAt: new Date(),
      },
    });

    // 6. Best-effort R2 delete (NoSuchKey is success).
    try {
      await app.r2.client.send(new DeleteObjectCommand({ Bucket: app.r2.bucket, Key: row.r2Key }));
    } catch (err) {
      const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
      const code = e.name ?? e.Code ?? '';
      const status = e.$metadata?.httpStatusCode;
      if (code !== 'NoSuchKey' && status !== 404) {
        req.log.warn({ err: e, r2Key: row.r2Key }, 'r2.delete_failed');
      }
    }

    // 7. Audit (encrypted).
    await app.audit.log('outbox.sent', {
      pdfId: row.id,
      target: maskedTarget,
      evolutionMessageId,
      sizeBytes: bytes.byteLength,
    });

    return reply.code(200).send({ ok: true, evolutionMessageId });
  });
}
