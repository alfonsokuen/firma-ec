import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  buildAuditService,
  decryptAuditPayload,
  encryptPayload,
  parseAuditKey,
} from '../src/services/audit.js';

function fakePrisma(): {
  prisma: PrismaClient;
  rows: Array<{
    event: string;
    payloadCiphertext: Buffer;
    keyVersion: number;
  }>;
} {
  const rows: Array<{
    event: string;
    payloadCiphertext: Buffer;
    keyVersion: number;
  }> = [];
  const prisma = {
    auditLog: {
      create: async ({
        data,
      }: { data: { event: string; payloadCiphertext: Buffer; keyVersion: number } }) => {
        rows.push({
          event: data.event,
          payloadCiphertext: data.payloadCiphertext,
          keyVersion: data.keyVersion,
        });
        return { id: 'audit-' + String(rows.length) };
      },
    },
  } as unknown as PrismaClient;
  return { prisma, rows };
}

describe('audit service', () => {
  const k1 = randomBytes(32);
  const k2 = randomBytes(32);

  it('encrypt → decrypt roundtrip', () => {
    const ct = encryptPayload(k1, { hello: 'world', n: 7 });
    const out = decryptAuditPayload({ payloadCiphertext: ct, keyVersion: 1 }, { 1: k1 });
    expect(out).toEqual({ hello: 'world', n: 7 });
  });

  it('decrypt with wrong key throws', () => {
    const ct = encryptPayload(k1, { secret: 'x' });
    expect(() =>
      decryptAuditPayload({ payloadCiphertext: ct, keyVersion: 1 }, { 1: k2 }),
    ).toThrow();
  });

  it('rotation: v1 row decrypts only with v1 key', () => {
    const ct1 = encryptPayload(k1, { v: 1 });
    const ct2 = encryptPayload(k2, { v: 2 });
    const out1 = decryptAuditPayload({ payloadCiphertext: ct1, keyVersion: 1 }, { 1: k1, 2: k2 });
    const out2 = decryptAuditPayload({ payloadCiphertext: ct2, keyVersion: 2 }, { 1: k1, 2: k2 });
    expect(out1).toEqual({ v: 1 });
    expect(out2).toEqual({ v: 2 });
    expect(() =>
      decryptAuditPayload({ payloadCiphertext: ct1, keyVersion: 99 }, { 1: k1, 2: k2 }),
    ).toThrow(/missing key/);
  });

  it('parseAuditKey requires 64 hex chars', () => {
    expect(() => parseAuditKey('short')).toThrow();
    expect(parseAuditKey('a'.repeat(64)).byteLength).toBe(32);
  });

  it('service.log writes a row whose payload contains no plaintext fragment', async () => {
    const { prisma, rows } = fakePrisma();
    const audit = buildAuditService({ prisma, key: k1, keyVersion: 1 });
    const secret = 'PLAINTEXT_PHONE_5939';
    await audit.log('outbox.sent', { phone: secret, ok: true });
    expect(rows).toHaveLength(1);
    const stored = rows[0]!;
    expect(stored.event).toBe('outbox.sent');
    expect(stored.keyVersion).toBe(1);
    // Plaintext fragment must NOT appear anywhere in the bytes stored.
    expect(stored.payloadCiphertext.includes(Buffer.from(secret))).toBe(false);
    // But decrypt with correct key should restore it.
    const out = decryptAuditPayload(stored, { 1: k1 });
    expect(out).toEqual({ phone: secret, ok: true });
  });

  it('service.log swallows DB errors (does not throw upstream)', async () => {
    const prisma = {
      auditLog: {
        create: async () => {
          throw new Error('DB down');
        },
      },
    } as unknown as PrismaClient;
    const warns: unknown[] = [];
    const audit = buildAuditService({
      prisma,
      key: k1,
      keyVersion: 1,
      log: { warn: (...a: unknown[]) => warns.push(a) },
    });
    await expect(audit.log('test.event', { x: 1 })).resolves.toBeUndefined();
    expect(warns.length).toBe(1);
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() =>
      buildAuditService({
        prisma: { auditLog: { create: async () => ({}) } } as unknown as PrismaClient,
        key: Buffer.alloc(16),
        keyVersion: 1,
      }),
    ).toThrow(/32 bytes/);
  });
});
