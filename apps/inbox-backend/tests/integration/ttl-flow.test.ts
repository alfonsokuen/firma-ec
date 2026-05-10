/**
 * Integration: TTL cleaner sweep — soft-delete expired rows + delete from R2,
 * leave fresh rows alone, hard-delete tombstones older than 7 days.
 */
import { describe, it, expect } from 'vitest';
import { startTtlCleaner } from '../../src/services/ttl-cleaner.js';
import { buildMemoryPrisma } from '../helpers/mockPrisma.js';
import { buildMemoryS3 } from '../helpers/mockS3.js';

describe('integration: ttl flow', () => {
  it('sweeps 3 expired rows, leaves 2 fresh untouched', async () => {
    const now = Date.now();
    const prisma = buildMemoryPrisma();
    const expired = [
      { id: 'e1', r2Key: 'k1', ttl: -10_000 },
      { id: 'e2', r2Key: 'k2', ttl: -5_000 },
      { id: 'e3', r2Key: 'k3', ttl: -1_000 },
    ];
    const fresh = [
      { id: 'f1', r2Key: 'k4', ttl: 60_000 },
      { id: 'f2', r2Key: 'k5', ttl: 120_000 },
    ];
    for (const r of [...expired, ...fresh]) {
      prisma.pdfs.set(r.id, {
        id: r.id,
        otpHash: `hash-${r.id}`,
        senderPhoneHash: 'p',
        messageId: `m-${r.id}`,
        r2Key: r.r2Key,
        salt: new Uint8Array(16),
        sizeBytes: 100,
        ttlAt: new Date(now + r.ttl),
        status: 'PENDING',
        createdAt: new Date(),
        consumedAt: null,
        deletedAt: null,
      });
    }
    const s3 = buildMemoryS3();
    for (const r of [...expired, ...fresh]) s3.storage.set(r.r2Key, Buffer.alloc(64));

    const audited: Array<{ event: string }> = [];
    const handle = startTtlCleaner({
      prisma: prisma.prisma,
      r2: { client: s3.client, bucket: 'b' },
      audit: { log: async (event) => { audited.push({ event }); } },
      intervalMs: 60_000,
    });
    const out = await handle.tick();
    handle.stop();

    expect(out.softDeleted).toBe(3);
    expect(s3.deleted.sort()).toEqual(['k1', 'k2', 'k3']);
    expect(prisma.pdfs.get('e1')?.status).toBe('DELETED');
    expect(prisma.pdfs.get('e2')?.status).toBe('DELETED');
    expect(prisma.pdfs.get('e3')?.status).toBe('DELETED');
    expect(prisma.pdfs.get('f1')?.status).toBe('PENDING');
    expect(prisma.pdfs.get('f2')?.status).toBe('PENDING');
    expect(audited.find((a) => a.event === 'ttl.cleaned')).toBeDefined();
  });

  it('hard-deletes tombstones older than 7 days, keeps recent', async () => {
    const now = Date.now();
    const prisma = buildMemoryPrisma();
    prisma.pdfs.set('old', {
      id: 'old',
      otpHash: 'h-old', senderPhoneHash: 'p', messageId: 'm-old',
      r2Key: 'a', salt: new Uint8Array(16), sizeBytes: 1,
      ttlAt: new Date(now - 1000),
      status: 'DELETED',
      createdAt: new Date(),
      consumedAt: null,
      deletedAt: new Date(now - 10 * 24 * 3600 * 1000),
    });
    prisma.pdfs.set('rec', {
      id: 'rec',
      otpHash: 'h-rec', senderPhoneHash: 'p', messageId: 'm-rec',
      r2Key: 'b', salt: new Uint8Array(16), sizeBytes: 1,
      ttlAt: new Date(now - 1000),
      status: 'DELETED',
      createdAt: new Date(),
      consumedAt: null,
      deletedAt: new Date(now - 1 * 24 * 3600 * 1000),
    });
    const s3 = buildMemoryS3();
    const handle = startTtlCleaner({
      prisma: prisma.prisma,
      r2: { client: s3.client, bucket: 'b' },
      audit: { log: async () => {} },
      intervalMs: 60_000,
    });
    const out = await handle.tick();
    handle.stop();

    expect(out.hardDeleted).toBe(1);
    expect(prisma.pdfs.has('old')).toBe(false);
    expect(prisma.pdfs.has('rec')).toBe(true);
  });

  it('NoSuchKey from R2 still soft-deletes the row', async () => {
    const now = Date.now();
    const prisma = buildMemoryPrisma();
    prisma.pdfs.set('orphan', {
      id: 'orphan',
      otpHash: 'h', senderPhoneHash: 'p', messageId: 'm',
      r2Key: 'gone', salt: new Uint8Array(16), sizeBytes: 1,
      ttlAt: new Date(now - 1000),
      status: 'PENDING',
      createdAt: new Date(),
      consumedAt: null,
      deletedAt: null,
    });
    // Empty S3 → DeleteObjectCommand on missing key returns OK in mock,
    // matching the documented "NoSuchKey treated as success" semantics.
    const s3 = buildMemoryS3();
    const handle = startTtlCleaner({
      prisma: prisma.prisma,
      r2: { client: s3.client, bucket: 'b' },
      audit: { log: async () => {} },
      intervalMs: 60_000,
    });
    const out = await handle.tick();
    handle.stop();
    expect(out.softDeleted).toBe(1);
    expect(prisma.pdfs.get('orphan')?.status).toBe('DELETED');
  });
});
