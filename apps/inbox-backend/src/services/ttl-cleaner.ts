/**
 * TTL cleaner — long-lived background sweep.
 *
 * Pass 1 (soft delete):
 *   Find rows with ttlAt < now AND status != DELETED. Delete the R2 object
 *   (NoSuchKey treated as success), then mark status='DELETED' + deletedAt=now.
 *
 * Pass 2 (hard delete, retention 7d):
 *   Drop AuditLog-aside rows where status='DELETED' AND deletedAt < now-7d.
 *   This keeps the table from growing forever while leaving an audit trail
 *   in the encrypted AuditLog.
 *
 * The service is started from server.ts on `ready` (skipped under NODE_ENV=test
 * unless explicitly invoked) and stopped on `onClose`. Each tick is awaited
 * fully so a slow R2 cycle never overlaps with the next setInterval firing.
 */
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import type { S3Client } from '@aws-sdk/client-s3';
import type { FastifyBaseLogger } from 'fastify';
import type { AuditService } from './audit.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const HARD_DELETE_AGE_MS = 7 * 24 * 3600 * 1000;
const BATCH_SIZE = 500;

export interface TtlCleanerOpts {
  prisma: PrismaClient;
  r2: { client: S3Client; bucket: string };
  audit: AuditService;
  intervalMs?: number;
  log?: FastifyBaseLogger | { warn: (...a: unknown[]) => void; info?: (...a: unknown[]) => void };
}

export interface TtlCleanerHandle {
  /** Run a single sweep cycle. Useful for tests + first-tick warmup. */
  tick: () => Promise<{ softDeleted: number; hardDeleted: number }>;
  /** Stop the interval. Idempotent. */
  stop: () => void;
}

export function startTtlCleaner(opts: TtlCleanerOpts): TtlCleanerHandle {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  async function tick(): Promise<{ softDeleted: number; hardDeleted: number }> {
    const now = new Date();
    let softDeleted = 0;
    let hardDeleted = 0;

    // Pass 1 — soft delete expired pending rows.
    const expired = await opts.prisma.pendingPdf.findMany({
      where: {
        ttlAt: { lt: now },
        status: { not: 'DELETED' as const },
      },
      take: BATCH_SIZE,
      select: { id: true, r2Key: true },
    });

    const softIds: string[] = [];
    for (const row of expired) {
      try {
        await opts.r2.client.send(
          new DeleteObjectCommand({ Bucket: opts.r2.bucket, Key: row.r2Key }),
        );
      } catch (err) {
        const e = err as {
          name?: string;
          Code?: string;
          $metadata?: { httpStatusCode?: number };
        };
        const code = e.name ?? e.Code ?? '';
        const status = e.$metadata?.httpStatusCode;
        if (code !== 'NoSuchKey' && status !== 404) {
          opts.log?.warn?.({ err: e, r2Key: row.r2Key }, 'ttl.r2_delete_failed');
          continue; // don't mark deleted if R2 is genuinely broken
        }
      }
      try {
        await opts.prisma.pendingPdf.update({
          where: { id: row.id },
          data: { status: 'DELETED' as const, deletedAt: now },
        });
        softIds.push(row.id);
        softDeleted++;
      } catch (err) {
        opts.log?.warn?.({ err, id: row.id }, 'ttl.row_update_failed');
      }
    }

    // Pass 2 — hard delete tombstones older than 7 days.
    const cutoff = new Date(now.getTime() - HARD_DELETE_AGE_MS);
    try {
      const purge = await opts.prisma.pendingPdf.deleteMany({
        where: {
          status: 'DELETED' as const,
          deletedAt: { lt: cutoff },
        },
      });
      hardDeleted = purge.count;
    } catch (err) {
      opts.log?.warn?.({ err }, 'ttl.hard_delete_failed');
    }

    if (softDeleted > 0 || hardDeleted > 0) {
      try {
        await opts.audit.log('ttl.cleaned', {
          softDeleted,
          hardDeleted,
          ids: softIds,
          at: now.toISOString(),
        });
      } catch (err) {
        opts.log?.warn?.({ err }, 'ttl.audit_failed');
      }
    }

    return { softDeleted, hardDeleted };
  }

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(() => {
      tick()
        .catch((err: unknown) => {
          opts.log?.warn?.({ err }, 'ttl.tick_threw');
        })
        .finally(() => {
          schedule();
        });
    }, intervalMs);
    // Don't keep the event loop alive purely for the cleaner.
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  schedule();

  return {
    tick,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
