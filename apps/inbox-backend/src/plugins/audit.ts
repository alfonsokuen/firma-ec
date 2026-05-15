import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { type AuditService, buildAuditService, parseAuditKey } from '../services/audit.js';

declare module 'fastify' {
  interface FastifyInstance {
    audit: AuditService;
  }
}

export interface AuditPluginOpts {
  /** Hex-encoded 32-byte AES key (INBOX_AUDIT_KEY). */
  keyHex: string;
  keyVersion: number;
  /** Override (e.g. mock) for tests. */
  service?: AuditService;
}

export default fp<AuditPluginOpts>(
  async function auditPlugin(app: FastifyInstance, opts) {
    const service =
      opts.service ??
      buildAuditService({
        prisma: app.prisma,
        key: parseAuditKey(opts.keyHex),
        keyVersion: opts.keyVersion,
        log: app.log,
      });
    app.decorate('audit', service);
  },
  { name: 'audit', dependencies: ['prisma'] },
);
