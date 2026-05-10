import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { encryptForR2 } from '@firma-ec/inbox-crypto';
import { verifyEvolutionSignature } from '../lib/hmac.js';
import { hashPhone } from '../lib/phone-hash.js';
import { InboxError } from '../lib/errors.js';
import {
  generateOtp,
  hashOtp,
  otpLookupKey,
  storeOtpInRedis,
} from '../services/otp.js';
import { checkAndConsume, BUCKETS } from '../services/rate-limit.js';
import type { Env } from '../env.js';

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB

interface DocumentMessage {
  mimetype?: string;
  fileLength?: number | string;
}

interface EvoMessageKey {
  id?: string;
  remoteJid?: string;
  fromMe?: boolean;
}

interface EvoMessageBody {
  documentMessage?: DocumentMessage;
  documentWithCaptionMessage?: { message?: { documentMessage?: DocumentMessage } };
}

interface EvoData {
  key?: EvoMessageKey;
  message?: EvoMessageBody;
}

interface EvoEnvelope {
  event?: string;
  data?: EvoData;
}

function pickDocument(data: EvoData | undefined): DocumentMessage | undefined {
  const m = data?.message;
  if (!m) return undefined;
  if (m.documentMessage) return m.documentMessage;
  if (m.documentWithCaptionMessage?.message?.documentMessage) {
    return m.documentWithCaptionMessage.message.documentMessage;
  }
  return undefined;
}

const SIG_HEADERS = ['x-evolution-signature', 'x-hub-signature-256'] as const;

function readSignature(req: FastifyRequest): string | undefined {
  for (const h of SIG_HEADERS) {
    const v = req.headers[h];
    if (typeof v === 'string' && v !== '') return v;
  }
  return undefined;
}

export interface WebhookWaOpts {
  env: Env;
}

export default async function webhookWaRoutes(
  app: FastifyInstance,
  opts: WebhookWaOpts,
): Promise<void> {
  const { env } = opts;

  app.post(
    '/webhook/wa',
    {
      // Raw body required for HMAC. fastify-raw-body decoration:
      config: { rawBody: true } as Record<string, unknown>,
    },
    async (req, reply) => {
      const raw = (req as FastifyRequest & { rawBody?: Buffer }).rawBody;
      if (!raw) {
        throw new InboxError('internal', 'rawBody not captured');
      }

      // 1. HMAC
      const sig = readSignature(req);
      if (!verifyEvolutionSignature(raw, sig, env.WEBHOOK_HMAC_SECRET)) {
        throw new InboxError('bad_hmac', 'invalid signature');
      }

      // 2. Body
      let body: EvoEnvelope;
      try {
        body = JSON.parse(raw.toString('utf8')) as EvoEnvelope;
      } catch {
        throw new InboxError('invalid_input', 'malformed json');
      }

      // 3. Filter
      if (body.event !== 'messages.upsert') {
        return reply.code(200).send({ ok: true, ignored: 'event' });
      }
      const data = body.data;
      const fromMe = data?.key?.fromMe === true;
      if (fromMe) {
        return reply.code(200).send({ ok: true, ignored: 'from_me' });
      }
      const doc = pickDocument(data);
      if (!doc || doc.mimetype !== 'application/pdf') {
        return reply.code(200).send({ ok: true, ignored: 'no_pdf' });
      }
      const messageId = data?.key?.id;
      const remoteJid = data?.key?.remoteJid;
      if (!messageId || !remoteJid) {
        return reply.code(200).send({ ok: true, ignored: 'no_key' });
      }

      // 4. Idempotency
      const dup = await app.prisma.pendingPdf.findUnique({
        where: { messageId },
        select: { id: true },
      });
      if (dup) {
        return reply.code(200).send({ ok: true, ignored: 'duplicate' });
      }

      const phoneHash = hashPhone(remoteJid, env.INBOX_DEPLOY_SECRET);

      // 5. Rate limits
      const msgRl = await checkAndConsume(
        app.redis.client,
        BUCKETS.msgPerPhone(phoneHash),
      );
      if (!msgRl.ok) {
        throw new InboxError('rate_limited', 'msg rate limit', {
          retryAfterS: msgRl.retryAfterS,
        });
      }
      const dayRl = await checkAndConsume(
        app.redis.client,
        BUCKETS.pdfPerDay(phoneHash),
      );
      if (!dayRl.ok) {
        throw new InboxError('rate_limited', 'pdf/day rate limit', {
          retryAfterS: dayRl.retryAfterS,
        });
      }

      // 6. Size pre-check (announced size; real check after fetch).
      const announced = Number(doc.fileLength ?? 0);
      if (announced > MAX_PDF_BYTES) {
        await safeNotify(
          app,
          remoteJid,
          'Tu PDF excede 20MB. Comprímelo o envía por email (próximamente).',
        );
        throw new InboxError('pdf_too_large', 'announced > 20MB', { announced });
      }

      // 8. Fetch PDF base64
      const base64 = await app.evolution.getBase64FromMediaMessage(data);
      const plaintext = Buffer.from(base64, 'base64');
      if (plaintext.byteLength > MAX_PDF_BYTES) {
        await safeNotify(
          app,
          remoteJid,
          'Tu PDF excede 20MB. Comprímelo o envía por email (próximamente).',
        );
        throw new InboxError('pdf_too_large', 'fetched > 20MB');
      }

      // 7. OTP + salt
      const otp = generateOtp();
      const salt = new Uint8Array(randomBytes(16));

      // 9. Encrypt
      const { iv, ciphertext } = await encryptForR2(otp, salt, new Uint8Array(plaintext));

      // 10. Upload to R2 (iv || ciphertext)
      const r2Key = `${randomUUID()}.bin`;
      const body64 = Buffer.concat([Buffer.from(iv), Buffer.from(ciphertext)]);
      await app.r2.client.send(
        new PutObjectCommand({
          Bucket: app.r2.bucket,
          Key: r2Key,
          Body: body64,
          ContentType: 'application/octet-stream',
        }),
      );

      // 11. Persist row
      const otpHashed = await hashOtp(otp, env.INBOX_DEPLOY_SECRET);
      const ttlAt = new Date(Date.now() + 24 * 3600 * 1000);
      const created = await app.prisma.pendingPdf.create({
        data: {
          otpHash: otpHashed,
          senderPhoneHash: phoneHash,
          messageId,
          r2Key,
          salt: Buffer.from(salt),
          sizeBytes: plaintext.byteLength,
          ttlAt,
        },
        select: { id: true },
      });

      // 12. Redis OTP lookup
      const lookup = otpLookupKey(otp, env.INBOX_DEPLOY_SECRET);
      await storeOtpInRedis(app.redis, lookup, created.id, 600);

      // 13. Reply via WA with link including OTP
      const link = `${env.BASE_URL.replace(/\/+$/, '')}/inbox?t=${otp}`;
      await safeNotify(
        app,
        remoteJid,
        `📄 Recibí tu PDF. Ábrelo en firmar.ec con este enlace (15 min):\n${link}`,
      );

      // 14. Audit (encrypted log lands in T19; log opaque counters only)
      req.log.info(
        { event: 'wa.received', pdfId: created.id, sizeBytes: plaintext.byteLength },
        'wa.received',
      );

      return reply.code(200).send({ ok: true });
    },
  );
}

async function safeNotify(
  app: FastifyInstance,
  jid: string,
  text: string,
): Promise<void> {
  try {
    await app.evolution.sendText(jid, text);
  } catch (err) {
    app.log.warn({ err, jid: '[REDACTED]' }, 'sendText failed');
  }
}
