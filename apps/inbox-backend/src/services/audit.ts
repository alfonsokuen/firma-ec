/**
 * Encrypted audit log service.
 *
 * All payloads are AES-256-GCM encrypted with INBOX_AUDIT_KEY before they hit
 * the DB. The DB column `payloadCiphertext` is `iv (12B) || ciphertext+tag`.
 * `keyVersion` is stored alongside so future rotations can decrypt historical
 * rows during forensics without re-encrypting in place.
 *
 * CRITICAL: callers must NEVER log plaintext PDF bytes, OTPs, or phone numbers
 * via pino. The audit log is the only persistence path and it's encrypted at
 * rest by this service.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

export interface AuditService {
  log: (event: string, payload: Record<string, unknown>) => Promise<void>;
}

export interface AuditServiceOpts {
  prisma: PrismaClient;
  /** 32-byte AES key. */
  key: Buffer;
  /** Schema-level version label written to each row. */
  keyVersion: number;
  log?: FastifyBaseLogger | { warn: (...a: unknown[]) => void };
}

export function buildAuditService(opts: AuditServiceOpts): AuditService {
  if (opts.key.byteLength !== 32) {
    throw new Error(
      `audit: key must be 32 bytes, got ${String(opts.key.byteLength)}`,
    );
  }
  return {
    async log(event, payload) {
      try {
        const ciphertext = encryptPayload(opts.key, payload);
        // Copy into a fresh ArrayBuffer-backed Uint8Array (Prisma Bytes type).
        const ab = new ArrayBuffer(ciphertext.byteLength);
        const u8 = new Uint8Array(ab);
        u8.set(ciphertext);
        await opts.prisma.auditLog.create({
          data: {
            event,
            payloadCiphertext: u8,
            keyVersion: opts.keyVersion,
          },
        });
      } catch (err) {
        // Audit must never throw upstream — degrade to warn.
        opts.log?.warn?.({ err, event }, 'audit.log_failed');
      }
    },
  };
}

/** Encrypt a JSON-serializable payload. Returns `iv || ciphertext+tag`. */
export function encryptPayload(
  key: Buffer,
  payload: Record<string, unknown>,
): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]);
}

/** Decrypt a row's `payloadCiphertext` (Buffer = iv || ciphertext+tag). */
export function decryptAuditPayload(
  row: { payloadCiphertext: Buffer; keyVersion: number },
  keys: Record<number, Buffer>,
): Record<string, unknown> {
  const key = keys[row.keyVersion];
  if (!key) {
    throw new Error(`audit: missing key for version ${String(row.keyVersion)}`);
  }
  const blob = row.payloadCiphertext;
  if (blob.length < IV_LEN + TAG_LEN) {
    throw new Error('audit: ciphertext too short');
  }
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ciphertext = blob.subarray(IV_LEN, blob.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as Record<string, unknown>;
}

/** Parse the env hex key into a 32-byte Buffer. */
export function parseAuditKey(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('audit: INBOX_AUDIT_KEY must be 64 hex chars');
  }
  return Buffer.from(hex, 'hex');
}
