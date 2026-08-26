import pino, { type LoggerOptions } from 'pino';

/**
 * Pino options for verify-api.
 *
 * Privacy posture, inherited from stats-backend and stricter here because this
 * service receives whole DOCUMENTS: the client IP is removed from the log (not
 * masked — removed, so no gap remains), and nothing derived from the PDF body
 * is ever logged. Route handlers log counts and verdict codes only.
 */
export const loggerOptions: LoggerOptions = {
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.remoteAddress',
      'req.remotePort',
    ],
    remove: true,
  },
  base: { service: 'verify-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
};

export const logger = pino(loggerOptions);
