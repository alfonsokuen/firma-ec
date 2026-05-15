import type { Readable } from 'node:stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../env.js';
import { requireJwt } from '../lib/auth.js';
import { InboxError } from '../lib/errors.js';

export interface InboxRoutesOpts {
  env: Env;
}

export default async function inboxRoutes(
  app: FastifyInstance,
  opts: InboxRoutesOpts,
): Promise<void> {
  const { env } = opts;
  const auth = requireJwt(env.INBOX_JWT_SECRET);

  // GET /api/inbox — list pending PDFs for caller's OTP.
  app.get('/api/inbox', { preHandler: auth }, async (req, _reply) => {
    const otpHash = req.inboxAuth?.otpHash;
    if (!otpHash) throw new InboxError('unauthorized');
    const rows = await app.prisma.pendingPdf.findMany({
      where: { otpHash, status: 'PENDING' },
      select: {
        id: true,
        sizeBytes: true,
        createdAt: true,
        salt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      sizeBytes: r.sizeBytes,
      createdAt: r.createdAt.toISOString(),
      saltB64: Buffer.from(r.salt).toString('base64'),
    }));
  });

  // GET /api/inbox/:id/meta
  app.get<{ Params: { id: string } }>(
    '/api/inbox/:id/meta',
    { preHandler: auth },
    async (req, _reply) => {
      const otpHash = req.inboxAuth?.otpHash;
      if (!otpHash) throw new InboxError('unauthorized');
      const row = await app.prisma.pendingPdf.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          otpHash: true,
          sizeBytes: true,
          salt: true,
        },
      });
      if (!row || row.otpHash !== otpHash) {
        throw new InboxError('not_found');
      }
      return {
        id: row.id,
        sizeBytes: row.sizeBytes,
        saltB64: Buffer.from(row.salt).toString('base64'),
        senderPhoneMasked: '+593 ** *** ****',
      };
    },
  );

  // GET /api/inbox/:id/blob — streams iv||ciphertext, exposes iv via header.
  app.get<{ Params: { id: string } }>(
    '/api/inbox/:id/blob',
    { preHandler: auth },
    async (req, reply) => {
      const otpHash = req.inboxAuth?.otpHash;
      if (!otpHash) throw new InboxError('unauthorized');
      const row = await app.prisma.pendingPdf.findUnique({
        where: { id: req.params.id },
        select: { otpHash: true, r2Key: true },
      });
      if (!row || row.otpHash !== otpHash) {
        throw new InboxError('not_found');
      }

      const obj = await app.r2.client.send(
        new GetObjectCommand({ Bucket: app.r2.bucket, Key: row.r2Key }),
      );
      const stream = obj.Body as Readable | undefined;
      if (!stream) throw new InboxError('not_found', 'r2 body missing');

      // Read entire stream so we can split iv (first 12 bytes) from ciphertext.
      const chunks: Buffer[] = [];
      for await (const c of stream) {
        chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
      }
      const all = Buffer.concat(chunks);
      if (all.length < 12) throw new InboxError('decrypt_failed', 'object too small');
      const iv = all.subarray(0, 12);
      const ciphertext = all.subarray(12);

      reply
        .header('content-type', 'application/octet-stream')
        .header('x-iv-hex', iv.toString('hex'))
        .header('cache-control', 'no-store');
      return reply.send(ciphertext);
    },
  );
}
