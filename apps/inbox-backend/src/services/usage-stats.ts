/**
 * usage-stats.ts — anonymous, privacy-safe usage counters for the public
 * landing stats strip (firmas / verificaciones / certificados).
 *
 * Signing and verification happen entirely client-side (zero-knowledge), so the
 * server can never *attest* that a signature really occurred. These counters
 * are therefore best-effort usage tallies fed by an anonymous beacon — no PII,
 * no per-event rows, just a running total per key, incremented atomically.
 *
 * The certificate count, by contrast, is exact: a COUNT over cert_orders. It is
 * only read where that subsystem exists (FEATURE_CERT_STATS); elsewhere the
 * raw query is caught and the field reported as null so the UI hides it.
 */
import type { PrismaClient } from '@prisma/client';

export type UsageCounterKey = 'sign' | 'verify';

/** Atomic upsert-increment. Row is created lazily on the first hit. */
export async function incrementUsage(prisma: PrismaClient, key: UsageCounterKey): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "usage_counters" ("key", "count", "updatedAt")
    VALUES (${key}, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("key") DO UPDATE
      SET "count" = "usage_counters"."count" + 1,
          "updatedAt" = CURRENT_TIMESTAMP
  `;
}

export interface UsageStats {
  pdfsSigned: number;
  signaturesVerified: number;
  /** null when the certificate subsystem is not present on this deploy. */
  certificatesIssued: number | null;
}

export async function readUsageStats(
  prisma: PrismaClient,
  opts: { includeCerts: boolean },
): Promise<UsageStats> {
  const rows = await prisma.$queryRaw<Array<{ key: string; count: bigint }>>`
    SELECT "key", "count" FROM "usage_counters" WHERE "key" IN ('sign', 'verify')
  `;
  const byKey = new Map(rows.map((r) => [r.key, Number(r.count)]));

  let certificatesIssued: number | null = null;
  if (opts.includeCerts) {
    try {
      const certRows = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM "cert_orders" WHERE "status" = 'SUBMITTED'
      `;
      certificatesIssued = Number(certRows[0]?.n ?? 0);
    } catch {
      // Table absent on this deploy — report null, never fail the endpoint.
      certificatesIssued = null;
    }
  }

  return {
    pdfsSigned: byKey.get('sign') ?? 0,
    signaturesVerified: byKey.get('verify') ?? 0,
    certificatesIssued,
  };
}
