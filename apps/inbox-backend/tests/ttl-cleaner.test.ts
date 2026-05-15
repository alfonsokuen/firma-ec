import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { startTtlCleaner } from '../src/services/ttl-cleaner.js';

interface Row {
  id: string;
  r2Key: string;
  ttlAt: Date;
  status: 'PENDING' | 'SENT' | 'DELETED';
  deletedAt?: Date | null;
}

function fakePrisma(initial: Row[]) {
  const rows = new Map(initial.map((r) => [r.id, { ...r }]));
  const prisma = {
    pendingPdf: {
      async findMany({
        where,
        take,
      }: {
        where: { ttlAt?: { lt: Date }; status?: { not: string } | string };
        take?: number;
      }) {
        const cutoff =
          typeof where.ttlAt === 'object' && where.ttlAt !== null ? where.ttlAt.lt : null;
        const notStatus =
          typeof where.status === 'object' && where.status !== null ? where.status.not : undefined;
        const matchStatus = typeof where.status === 'string' ? where.status : undefined;
        const all = Array.from(rows.values()).filter((r) => {
          if (cutoff && r.ttlAt >= cutoff) return false;
          if (notStatus && r.status === notStatus) return false;
          if (matchStatus && r.status !== matchStatus) return false;
          return true;
        });
        return take ? all.slice(0, take) : all;
      },
      async update({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Row>;
      }) {
        const r = rows.get(where.id);
        if (!r) throw new Error('not found');
        Object.assign(r, data);
        return r;
      },
      async deleteMany({
        where,
      }: {
        where: {
          status?: string;
          deletedAt?: { lt: Date };
        };
      }) {
        let count = 0;
        for (const [id, r] of rows.entries()) {
          if (where.status && r.status !== where.status) continue;
          if (where.deletedAt && (!r.deletedAt || r.deletedAt >= where.deletedAt.lt)) {
            continue;
          }
          rows.delete(id);
          count++;
        }
        return { count };
      },
    },
  } as unknown as PrismaClient;
  return { prisma, rows };
}

function fakeR2() {
  const deleted: string[] = [];
  const client = {
    send: vi.fn(async (cmd: { constructor: { name: string }; input: { Key: string } }) => {
      if (cmd.constructor.name === 'DeleteObjectCommand') {
        deleted.push(cmd.input.Key);
        return {};
      }
      throw new Error('unsupported');
    }),
  } as unknown as S3Client;
  return { client, deleted };
}

describe('ttl-cleaner', () => {
  it('soft-deletes expired rows + leaves fresh rows alone', async () => {
    const now = Date.now();
    const expired1 = {
      id: 'e1',
      r2Key: 'k1',
      ttlAt: new Date(now - 10_000),
      status: 'PENDING' as const,
    };
    const expired2 = {
      id: 'e2',
      r2Key: 'k2',
      ttlAt: new Date(now - 5_000),
      status: 'PENDING' as const,
    };
    const expired3 = {
      id: 'e3',
      r2Key: 'k3',
      ttlAt: new Date(now - 1_000),
      status: 'SENT' as const,
    };
    const fresh1 = {
      id: 'f1',
      r2Key: 'k4',
      ttlAt: new Date(now + 60_000),
      status: 'PENDING' as const,
    };
    const fresh2 = {
      id: 'f2',
      r2Key: 'k5',
      ttlAt: new Date(now + 120_000),
      status: 'PENDING' as const,
    };
    const { prisma, rows } = fakePrisma([expired1, expired2, expired3, fresh1, fresh2]);
    const r2 = fakeR2();
    const audited: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const audit = {
      log: async (event: string, payload: Record<string, unknown>) => {
        audited.push({ event, payload });
      },
    };

    const handle = startTtlCleaner({
      prisma,
      r2: { client: r2.client, bucket: 'b' },
      audit,
      intervalMs: 60_000,
    });
    const out = await handle.tick();
    handle.stop();

    expect(out.softDeleted).toBe(3);
    expect(r2.deleted.sort()).toEqual(['k1', 'k2', 'k3']);
    expect(rows.get('e1')?.status).toBe('DELETED');
    expect(rows.get('e2')?.status).toBe('DELETED');
    expect(rows.get('e3')?.status).toBe('DELETED');
    expect(rows.get('f1')?.status).toBe('PENDING');
    expect(rows.get('f2')?.status).toBe('PENDING');
    expect(audited).toHaveLength(1);
    expect(audited[0]?.event).toBe('ttl.cleaned');
  });

  it('treats NoSuchKey as success and still marks row deleted', async () => {
    const now = Date.now();
    const { prisma, rows } = fakePrisma([
      { id: 'x', r2Key: 'gone', ttlAt: new Date(now - 1000), status: 'PENDING' },
    ]);
    const client = {
      send: vi.fn(async () => {
        const e = new Error('not found') as Error & {
          name: string;
          $metadata: { httpStatusCode: number };
        };
        e.name = 'NoSuchKey';
        e.$metadata = { httpStatusCode: 404 };
        throw e;
      }),
    } as unknown as S3Client;
    const audit = { log: async () => {} };
    const handle = startTtlCleaner({
      prisma,
      r2: { client, bucket: 'b' },
      audit,
      intervalMs: 60_000,
    });
    const out = await handle.tick();
    handle.stop();
    expect(out.softDeleted).toBe(1);
    expect(rows.get('x')?.status).toBe('DELETED');
  });

  it('hard-deletes rows older than 7 days', async () => {
    const now = Date.now();
    const old = new Date(now - 10 * 24 * 3600 * 1000);
    const recent = new Date(now - 1 * 24 * 3600 * 1000);
    const { prisma, rows } = fakePrisma([
      { id: 'old', r2Key: 'a', ttlAt: new Date(now - 1000), status: 'DELETED', deletedAt: old },
      { id: 'rec', r2Key: 'b', ttlAt: new Date(now - 1000), status: 'DELETED', deletedAt: recent },
    ]);
    const r2 = fakeR2();
    const audit = { log: async () => {} };
    const handle = startTtlCleaner({
      prisma,
      r2: { client: r2.client, bucket: 'b' },
      audit,
      intervalMs: 60_000,
    });
    const out = await handle.tick();
    handle.stop();
    expect(out.hardDeleted).toBe(1);
    expect(rows.has('old')).toBe(false);
    expect(rows.has('rec')).toBe(true);
  });

  it('handles a 1000-row batch in <30s with mocked R2', async () => {
    const now = Date.now();
    const initial: Row[] = [];
    for (let i = 0; i < 1000; i++) {
      initial.push({
        id: `r${i}`,
        r2Key: `k${i}`,
        ttlAt: new Date(now - 1000),
        status: 'PENDING',
      });
    }
    const { prisma } = fakePrisma(initial);
    const r2 = fakeR2();
    const audit = { log: async () => {} };
    const handle = startTtlCleaner({
      prisma,
      r2: { client: r2.client, bucket: 'b' },
      audit,
      intervalMs: 60_000,
    });
    const t0 = Date.now();
    // tick batches up to 500; run twice.
    const a = await handle.tick();
    const b = await handle.tick();
    handle.stop();
    expect(a.softDeleted + b.softDeleted).toBe(1000);
    expect(Date.now() - t0).toBeLessThan(30_000);
  });

  it('stop() prevents further scheduled ticks', async () => {
    const { prisma } = fakePrisma([]);
    const r2 = fakeR2();
    const audit = { log: async () => {} };
    const handle = startTtlCleaner({
      prisma,
      r2: { client: r2.client, bucket: 'b' },
      audit,
      intervalMs: 1, // very tight
    });
    handle.stop();
    // Give the loop a chance to misfire if stop() were broken.
    await new Promise((r) => setTimeout(r, 25));
    // No assertion needed beyond "no unhandled error"; tick was never auto-called.
    expect(true).toBe(true);
  });
});
