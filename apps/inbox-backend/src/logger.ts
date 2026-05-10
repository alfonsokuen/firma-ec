import pino, { type LoggerOptions } from 'pino';

/**
 * Pino logger options with strict redaction for privacy.
 *
 * Privacy claim (F3.5 spec): NO PII en logs. Phone numbers, OTPs, and
 * derived hashes never reach disk. Only opaque IDs (cuid) and counts.
 *
 * Exposed both as raw options (for Fastify's `logger` option, which expects
 * options not an instance — keeps types clean) and as a constructed instance
 * for ad-hoc use (workers, scripts).
 */
export const loggerOptions: LoggerOptions = {
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: {
    paths: [
      'phone',
      'phoneNumber',
      'senderPhone',
      'senderPhoneHash',
      'otp',
      'otpHash',
      'encryptedKeyHint',
      'r2Key',
      '*.phone',
      '*.phoneNumber',
      '*.senderPhone',
      '*.senderPhoneHash',
      '*.otp',
      '*.otpHash',
      '*.password',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
  base: { service: 'inbox-backend' },
  timestamp: pino.stdTimeFunctions.isoTime,
};

export const logger = pino(loggerOptions);
