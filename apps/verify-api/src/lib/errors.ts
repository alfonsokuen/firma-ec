/**
 * Domain-level error codes for verify-api.
 *
 * Mapped to HTTP status codes by the Fastify error handler.
 */
import type { FastifyInstance } from 'fastify';

export type VerifyErrorCode =
  | 'invalid_input'
  | 'too_many_signatures'
  | 'document_too_costly'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'idempotency_conflict'
  | 'idempotency_in_flight'
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
  too_many_signatures: 422,
  document_too_costly: 413,
  payload_too_large: 413,
  unsupported_media_type: 415,
  idempotency_conflict: 409,
  idempotency_in_flight: 409,
  verify_timeout: 504,
  rate_limited: 429,
  internal: 500,
};

export function registerErrorHandler(app: FastifyInstance): void {
  // Every response leaves through the same shape: `{ error: <our code> }`.
  // Framework codes (FST_ERR_*) are mapped, never echoed: they leak the stack
  // in use and make the contract inconsistent for clients.
  const FRAMEWORK_CODE_MAP: Record<string, VerifyErrorCode> = {
    FST_ERR_CTP_BODY_TOO_LARGE: 'payload_too_large',
    FST_ERR_CTP_INVALID_MEDIA_TYPE: 'unsupported_media_type',
    FST_ERR_CTP_EMPTY_JSON_BODY: 'invalid_input',
    FST_ERR_CTP_INVALID_CONTENT_LENGTH: 'invalid_input',
  };

  app.setNotFoundHandler((_req, reply) => {
    // Do NOT echo the requested route: it reflects attacker-controlled text.
    return reply.code(404).send({ error: 'not_found' });
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof VerifyApiError) {
      req.log.warn({ code: err.code }, 'verify error');
      return reply.code(err.httpStatus).send({ error: err.code, message: err.message });
    }
    const e = err as { validation?: unknown; statusCode?: number; code?: string; message?: string };

    const mapped = e.code === undefined ? undefined : FRAMEWORK_CODE_MAP[e.code];
    if (mapped !== undefined) {
      return reply.code(HTTP_STATUS_BY_CODE[mapped]).send({ error: mapped });
    }
    // @fastify/rate-limit answers 429 with no `code`, which used to surface as
    // the meaningless `{"error":"error"}` instead of the documented code.
    if (e.statusCode === 429) {
      return reply.code(429).send({ error: 'rate_limited' });
    }
    if (e.validation !== undefined) {
      return reply.code(422).send({ error: 'invalid_input' });
    }
    if (typeof e.statusCode === 'number' && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: 'invalid_input' });
    }
    // Never leak internals to a caller (security.md): log fully, answer opaquely.
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal' });
  });
}
