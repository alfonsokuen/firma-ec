/**
 * In-memory Prisma stand-in covering the surface used by inbox-backend routes
 * and ttl-cleaner: pendingPdf.{create,findUnique,findMany,update,deleteMany}
 * and auditLog.{create,findMany}.
 *
 * Trade-off: a real Prisma against pg-mem doesn't survive `prisma migrate`
 * cleanly without docker. A hand-rolled mock covers ~100% of the route logic
 * we care about for integration tests with zero infra and stable timing.
 */
import type { PrismaClient } from '@prisma/client';

export interface PendingPdfRow {
  id: string;
  otpHash: string;
  senderPhoneHash: string;
  messageId: string;
  r2Key: string;
  salt: Uint8Array;
  sizeBytes: number;
  encryptedKeyHint?: string | null;
  createdAt: Date;
  ttlAt: Date;
  status: 'PENDING' | 'SIGNED' | 'DELIVERED' | 'EXPIRED' | 'SENT' | 'DELETED';
  consumedAt?: Date | null;
  deletedAt?: Date | null;
}

export interface AuditLogRow {
  id: string;
  event: string;
  payloadCiphertext: Uint8Array;
  keyVersion: number;
  createdAt: Date;
}

export interface MemoryPrismaHandle {
  prisma: PrismaClient;
  pdfs: Map<string, PendingPdfRow>;
  audits: AuditLogRow[];
  /** Total queryRaw calls — health check uses this. */
  queryRawCalls: number;
}

interface PdfCreateData {
  otpHash: string;
  senderPhoneHash: string;
  messageId: string;
  r2Key: string;
  salt: Uint8Array | Buffer;
  sizeBytes: number;
  ttlAt: Date;
  status?: PendingPdfRow['status'];
  encryptedKeyHint?: string | null;
}

interface FindManyWhere {
  otpHash?: string;
  status?: { not: string } | string;
  ttlAt?: { lt: Date };
  deletedAt?: { lt: Date };
}

function matchPdf(row: PendingPdfRow, where: FindManyWhere): boolean {
  if (where.otpHash !== undefined && row.otpHash !== where.otpHash) return false;
  if (typeof where.status === 'string' && row.status !== where.status) return false;
  if (typeof where.status === 'object' && where.status !== null) {
    if (row.status === where.status.not) return false;
  }
  if (where.ttlAt && row.ttlAt >= where.ttlAt.lt) return false;
  if (where.deletedAt) {
    if (!row.deletedAt || row.deletedAt >= where.deletedAt.lt) return false;
  }
  return true;
}

export function buildMemoryPrisma(initial: PendingPdfRow[] = []): MemoryPrismaHandle {
  const pdfs = new Map<string, PendingPdfRow>(initial.map((r) => [r.id, { ...r }]));
  const byMessageId = new Map<string, string>();
  for (const r of pdfs.values()) byMessageId.set(r.messageId, r.id);
  const audits: AuditLogRow[] = [];
  let pdfCounter = pdfs.size;
  let auditCounter = 0;
  const handle: MemoryPrismaHandle = {
    pdfs,
    audits,
    queryRawCalls: 0,
    prisma: {} as PrismaClient,
  };

  const prisma = {
    async $queryRaw() {
      handle.queryRawCalls++;
      return [{ '?column?': 1 }];
    },
    async $disconnect() {},
    pendingPdf: {
      async findUnique({ where, select }: {
        where: { id?: string; messageId?: string };
        select?: Record<string, boolean>;
      }) {
        let row: PendingPdfRow | undefined;
        if (where.id) row = pdfs.get(where.id);
        else if (where.messageId) {
          const id = byMessageId.get(where.messageId);
          if (id) row = pdfs.get(id);
        }
        if (!row) return null;
        return select ? project(row, select) : row;
      },
      async create({ data, select }: { data: PdfCreateData; select?: Record<string, boolean> }) {
        pdfCounter++;
        const id = `pdf-${pdfCounter}`;
        const saltBytes = data.salt instanceof Buffer
          ? new Uint8Array(data.salt)
          : (data.salt instanceof Uint8Array ? data.salt : new Uint8Array(data.salt as ArrayBuffer));
        const row: PendingPdfRow = {
          id,
          otpHash: data.otpHash,
          senderPhoneHash: data.senderPhoneHash,
          messageId: data.messageId,
          r2Key: data.r2Key,
          salt: saltBytes,
          sizeBytes: data.sizeBytes,
          encryptedKeyHint: data.encryptedKeyHint ?? null,
          createdAt: new Date(),
          ttlAt: data.ttlAt,
          status: data.status ?? 'PENDING',
          consumedAt: null,
          deletedAt: null,
        };
        pdfs.set(id, row);
        byMessageId.set(row.messageId, id);
        return select ? project(row, select) : row;
      },
      async findMany({ where, select, take, orderBy: _orderBy }: {
        where: FindManyWhere;
        select?: Record<string, boolean>;
        take?: number;
        orderBy?: unknown;
      }) {
        const out: PendingPdfRow[] = [];
        for (const r of pdfs.values()) {
          if (matchPdf(r, where)) out.push(r);
        }
        // newest first (best-effort orderBy: createdAt desc)
        out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const sliced = take ? out.slice(0, take) : out;
        return select ? sliced.map((r) => project(r, select)) : sliced;
      },
      async update({ where, data, select }: {
        where: { id: string };
        data: Partial<PendingPdfRow>;
        select?: Record<string, boolean>;
      }) {
        const r = pdfs.get(where.id);
        if (!r) throw new Error(`pendingPdf.update: id ${where.id} not found`);
        Object.assign(r, data);
        return select ? project(r, select) : r;
      },
      async deleteMany({ where }: { where: FindManyWhere }) {
        let count = 0;
        for (const [id, r] of pdfs.entries()) {
          if (matchPdf(r, where)) {
            pdfs.delete(id);
            byMessageId.delete(r.messageId);
            count++;
          }
        }
        return { count };
      },
    },
    auditLog: {
      async create({ data }: {
        data: { event: string; payloadCiphertext: Uint8Array | Buffer; keyVersion: number };
      }) {
        auditCounter++;
        const id = `audit-${auditCounter}`;
        const ct = data.payloadCiphertext instanceof Uint8Array
          ? data.payloadCiphertext
          : new Uint8Array(data.payloadCiphertext);
        const row: AuditLogRow = {
          id,
          event: data.event,
          payloadCiphertext: ct,
          keyVersion: data.keyVersion,
          createdAt: new Date(),
        };
        audits.push(row);
        return row;
      },
      async findMany() {
        return [...audits];
      },
    },
  } as unknown as PrismaClient;

  handle.prisma = prisma;
  return handle;
}

function project(row: Record<string, unknown>, select: Record<string, boolean>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(select)) {
    if (select[k]) out[k] = row[k];
  }
  return out;
}
