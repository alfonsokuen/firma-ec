/**
 * Compose Fastify with all dependencies mocked — the entry point every
 * integration test uses.
 */
import { createHmac } from 'node:crypto';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { loadEnv, type Env } from '../../src/env.js';
import { buildMemoryPrisma, type MemoryPrismaHandle } from './mockPrisma.js';
import { buildMemoryS3, type MemoryS3Handle } from './mockS3.js';
import { buildMemoryEvolution, type MemoryEvolution } from './mockEvolution.js';
import type { AuditService } from '../../src/services/audit.js';

export interface TestAppHandles {
  app: FastifyInstance;
  env: Env;
  prisma: MemoryPrismaHandle;
  redis: Redis;
  s3: MemoryS3Handle;
  evolution: MemoryEvolution;
  /** Recorded {event, payload} from audit.log calls when overrideAudit=true. */
  auditCalls: Array<{ event: string; payload: Record<string, unknown> }>;
}

export interface BuildTestAppOpts {
  prisma?: MemoryPrismaHandle;
  s3?: MemoryS3Handle;
  evolution?: MemoryEvolution;
  redis?: Redis;
  /** When true, replace the encrypted AuditService with an in-memory recorder. */
  recordAuditCalls?: boolean;
  /** Override env (must already include test defaults). */
  env?: Env;
}

export async function buildTestApp(opts: BuildTestAppOpts = {}): Promise<TestAppHandles> {
  const env = opts.env ?? loadEnv();
  const prisma = opts.prisma ?? buildMemoryPrisma();
  const s3 = opts.s3 ?? buildMemoryS3();
  const evolution = opts.evolution ?? buildMemoryEvolution();
  const redis = opts.redis ?? (new RedisMock() as unknown as Redis);
  await redis.flushall();

  const auditCalls: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const auditOverride: AuditService | undefined = opts.recordAuditCalls
    ? {
        log: async (event, payload) => {
          auditCalls.push({ event, payload });
        },
      }
    : undefined;

  const app = await buildServer({
    env,
    disableRateLimit: true,
    overrides: {
      prisma: prisma.prisma,
      redis,
      r2Client: s3.client,
      evolution,
      ...(auditOverride ? { audit: auditOverride } : {}),
    },
  });
  return { app, env, prisma, redis, s3, evolution, auditCalls };
}

export function signWebhookBody(body: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** Build an Evolution `messages.upsert` envelope shaped like the real webhook. */
export function makeWebhookPayload(opts: {
  messageId: string;
  remoteJid?: string;
  fileLength?: number;
  fromMe?: boolean;
}): {
  event: string;
  data: {
    key: { id: string; remoteJid: string; fromMe: boolean };
    message: { documentMessage: { mimetype: string; fileLength: number } };
  };
} {
  return {
    event: 'messages.upsert',
    data: {
      key: {
        id: opts.messageId,
        remoteJid: opts.remoteJid ?? '593989778888@s.whatsapp.net',
        fromMe: opts.fromMe ?? false,
      },
      message: {
        documentMessage: {
          mimetype: 'application/pdf',
          fileLength: opts.fileLength ?? 1024,
        },
      },
    },
  };
}
