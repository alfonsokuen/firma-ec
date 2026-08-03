/**
 * Domain-level error codes for stats-backend.
 *
 * Mapped to HTTP status codes by the Fastify error handler in server.ts.
 */
import type { FastifyInstance } from 'fastify';

export type StatsErrorCode = 'invalid_input' | 'not_found' | 'rate_limited' | 'internal';

export class StatsError extends Error {
  public readonly code: StatsErrorCode;
  public readonly httpStatus: number;
  public readonly details?: Record<string, unknown>;

  constructor(code: StatsErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = 'StatsError';
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
    if (details !== undefined) {
      this.details = details;
    }
  }
}

const HTTP_STATUS_BY_CODE: Record<StatsErrorCode, number> = {
  invalid_input: 422,
  not_found: 404,
  rate_limited: 429,
  internal: 500,
};

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof StatsError) {
      req.log.warn({ code: err.code }, 'stats error');
      return reply.code(err.httpStatus).send({ error: err.code, message: err.message });
    }
    const e = err as { validation?: unknown; statusCode?: number; code?: string; message?: string };
    if (e.validation !== undefined) {
      return reply.code(422).send({ error: 'invalid_input', message: e.message });
    }
    if (typeof e.statusCode === 'number') {
      return reply.code(e.statusCode).send({ error: e.code ?? 'error', message: e.message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal' });
  });
}
