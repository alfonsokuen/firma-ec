/**
 * Domain-level error codes for inbox-backend.
 *
 * Mapped to HTTP status codes by the Fastify error handler in server.ts.
 */
import type { FastifyInstance } from 'fastify';

export type InboxErrorCode =
  | 'bad_hmac'
  | 'bad_otp'
  | 'rate_limited'
  | 'pdf_too_large'
  | 'replay_detected'
  | 'no_pdf_in_message'
  | 'decrypt_failed'
  | 'not_found'
  | 'unauthorized'
  | 'invalid_phone'
  | 'invalid_input'
  | 'internal';

export class InboxError extends Error {
  public readonly code: InboxErrorCode;
  public readonly httpStatus: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: InboxErrorCode,
    message?: string,
    details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = 'InboxError';
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
    if (details !== undefined) {
      this.details = details;
    }
  }
}

const HTTP_STATUS_BY_CODE: Record<InboxErrorCode, number> = {
  bad_hmac: 401,
  bad_otp: 401,
  unauthorized: 401,
  rate_limited: 429,
  pdf_too_large: 422,
  replay_detected: 200, // idempotent ack
  no_pdf_in_message: 200, // ignored ok
  decrypt_failed: 422,
  not_found: 404,
  invalid_phone: 422,
  invalid_input: 422,
  internal: 500,
};

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof InboxError) {
      req.log.warn({ code: err.code }, 'inbox error');
      return reply
        .code(err.httpStatus)
        .send({ error: err.code, message: err.message });
    }
    const e = err as { validation?: unknown; statusCode?: number; code?: string; message?: string };
    if (e.validation !== undefined) {
      return reply.code(422).send({ error: 'invalid_input', message: e.message });
    }
    if (typeof e.statusCode === 'number') {
      return reply
        .code(e.statusCode)
        .send({ error: e.code ?? 'error', message: e.message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal' });
  });
}
