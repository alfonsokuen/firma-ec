import pino, { type LoggerOptions } from 'pino';

/**
 * Pino logger options for stats-backend.
 *
 * Privacy: this service stores no PII at all (only anonymous counts), so the
 * redaction surface is minimal — just auth/cookie headers, kept for parity.
 *
 * Exposed both as raw options (for Fastify's `logger` option, which expects
 * options not an instance) and as a constructed instance for ad-hoc use.
 */
export const loggerOptions: LoggerOptions = {
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie'],
    censor: '[REDACTED]',
  },
  base: { service: 'stats-backend' },
  timestamp: pino.stdTimeFunctions.isoTime,
};

export const logger = pino(loggerOptions);
