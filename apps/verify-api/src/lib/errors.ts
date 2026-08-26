/**
 * Domain-level error codes for verify-api.
 *
 * Mapped to HTTP status codes by the Fastify error handler.
 */
import type { FastifyInstance } from 'fastify';

export type VerifyErrorCode =
  | 'invalid_input'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'verify_timeout'
  | 'rate_limited'
  | 'internal';

export class VerifyApiError extends Error {
  public readonly code: VerifyErrorCode;
  public readonly httpStatus: number;

  constructor(code: VerifyErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'VerifyApiError';
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
  }
}

const HTTP_STATUS_BY_CODE: Record<VerifyErrorCode, number> = {
  invalid_input: 422,
  payload_too_large: 413,
  unsupported_media_type: 415,
  verify_timeout: 504,
  rate_limited: 429,
  internal: 500,
};

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof VerifyApiError) {
      req.log.warn({ code: err.code }, 'verify error');
      return reply.code(err.httpStatus).send({ error: err.code, message: err.message });
    }
    const e = err as { validation?: unknown; statusCode?: number; code?: string; message?: string };
    // Fastify raises FST_ERR_CTP_BODY_TOO_LARGE when bodyLimit is exceeded.
    if (e.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({ error: 'payload_too_large', message: 'PDF exceeds the limit' });
    }
    if (e.validation !== undefined) {
      return reply.code(422).send({ error: 'invalid_input', message: e.message });
    }
    if (typeof e.statusCode === 'number') {
      return reply.code(e.statusCode).send({ error: e.code ?? 'error', message: e.message });
    }
    // Never leak internals to a caller (security.md): log fully, answer opaquely.
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal' });
  });
}
