import type { FastifyReply, FastifyRequest } from 'fastify';
import { InboxError } from './errors.js';
import { verifyJwt } from './jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    inboxAuth?: { otpHash: string };
  }
}

/**
 * Fastify preHandler that requires a valid `Authorization: Bearer <jwt>`.
 * Attaches `req.inboxAuth = { otpHash }` on success.
 */
export function requireJwt(secret: string) {
  return async function preHandler(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new InboxError('unauthorized', 'missing bearer token');
    }
    const token = auth.slice(7);
    try {
      const payload = await verifyJwt(token, secret);
      req.inboxAuth = payload;
    } catch {
      throw new InboxError('unauthorized', 'invalid token');
    }
  };
}
