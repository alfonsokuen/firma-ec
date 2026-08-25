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
    // `req.remoteAddress` / `req.remotePort`: con `trustProxy: true` el serializador
    // por defecto de Fastify escribe la IP REAL del cliente en cada peticion, en la
    // misma linea que la URL (que lleva `?type=sign`) y la marca de tiempo. Eso es
    // justo el cruce que el aviso de privacidad promete que no existe: reconstruiria
    // "quien firmo y a que hora". El limitador necesita la IP en memoria durante la
    // peticion; el log no la necesita nunca. Se elimina del log, no se censura, para
    // que no quede ni el hueco.
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.remoteAddress',
      'req.remotePort',
    ],
    remove: true,
  },
  base: { service: 'stats-backend' },
  timestamp: pino.stdTimeFunctions.isoTime,
};

export const logger = pino(loggerOptions);
