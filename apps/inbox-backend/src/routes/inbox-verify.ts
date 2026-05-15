import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../env.js';
import { InboxError } from '../lib/errors.js';
import { issueJwt } from '../lib/jwt.js';
import { maskPhone } from '../lib/phone-hash.js';
import { otpLookupKey } from '../services/otp.js';
import { BUCKETS, checkAndConsume } from '../services/rate-limit.js';

const BodySchema = z.object({
  otp: z.string().regex(/^\d{6}$/, 'otp must be 6 digits'),
});

export interface InboxVerifyOpts {
  env: Env;
}

export default async function inboxVerifyRoutes(
  app: FastifyInstance,
  opts: InboxVerifyOpts,
): Promise<void> {
  const { env } = opts;

  app.post('/api/inbox/verify', async (req, reply) => {
    const ip = req.ip || 'unknown';
    const ipRl = await checkAndConsume(app.redis.client, BUCKETS.otpPerIp(ip));
    if (!ipRl.ok) {
      throw new InboxError('rate_limited', 'otp rate limit', {
        retryAfterS: ipRl.retryAfterS,
      });
    }

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new InboxError('invalid_input', parsed.error.issues[0]?.message ?? 'bad otp');
    }
    const { otp } = parsed.data;

    const lookup = otpLookupKey(otp, env.INBOX_DEPLOY_SECRET);
    const pdfId = await app.redis.getOtp(lookup);
    if (!pdfId) {
      await app.audit.log('inbox.verify_fail', { reason: 'otp_miss', ip });
      throw new InboxError('bad_otp', 'otp not found or expired');
    }

    const row = await app.prisma.pendingPdf.findUnique({
      where: { id: pdfId },
      select: {
        id: true,
        otpHash: true,
        senderPhoneHash: true,
        sizeBytes: true,
        salt: true,
        createdAt: true,
        status: true,
      },
    });
    if (!row || row.status === 'EXPIRED' || row.status === 'DELIVERED') {
      await app.audit.log('inbox.verify_fail', {
        reason: 'row_unavailable',
        pdfId: row?.id,
        status: row?.status,
      });
      throw new InboxError('not_found', 'pdf no longer available');
    }

    const jwt = await issueJwt(row.otpHash, env.INBOX_JWT_SECRET);
    await app.audit.log('inbox.verify_ok', { pdfId: row.id });

    return reply.code(200).send({
      jwt,
      items: [
        {
          id: row.id,
          sizeBytes: row.sizeBytes,
          createdAt: row.createdAt.toISOString(),
          // We hash phones server-side; mask is best-effort placeholder.
          // Real masking requires storing the masked form at ingest (TODO T19).
          senderPhoneMasked: maskPhoneSafe(row.senderPhoneHash),
          saltB64: Buffer.from(row.salt).toString('base64'),
        },
      ],
    });
  });
}

function maskPhoneSafe(_hash: string): string {
  // We never store plaintext phone, so a true mask is impossible without
  // capturing it at ingest. Return a generic mask for v1.
  return '+593 ** *** ****';
}

export { maskPhone };
