/**
 * API key minting and verification.
 *
 * Design notes that are load-bearing:
 *
 * 1. **HMAC-SHA256 with a pepper, not argon2.** Argon2 exists to make guessing
 *    LOW-entropy secrets expensive — human passwords. These secrets carry ~190
 *    bits from a CSPRNG, so there is nothing to slow down: an attacker cannot
 *    enumerate that space at any cost factor. Putting argon2 on the hot path
 *    would instead hand out a denial-of-service primitive, since every request
 *    bearing a junk key would cost us ~64MB and tens of milliseconds. The pepper
 *    lives outside the database, so a stolen dump alone yields nothing.
 *
 * 2. **The token carries its own key id.** Lookup is a single indexed read on
 *    `keyId`; we never scan the table hashing candidates.
 *
 * 3. **A checksum guards against typos, not attackers.** It lets a client (and
 *    a secret scanner) reject a malformed token offline. It is not a security
 *    boundary and is never treated as one.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const PREFIX = 'fev';
const KEY_ID_CHARS = 12;
const SECRET_BYTES = 24; // ~190 bits
const CHECKSUM_CHARS = 6;

export type KeyEnvironment = 'live' | 'test';

export interface MintedKey {
  /** Shown to the user exactly once; never stored. */
  token: string;
  /** Public half, stored in the clear and indexed. */
  keyId: string;
  /** HMAC of the secret half under the pepper. Safe to store. */
  secretHash: string;
}

/** Encode bytes as base62. Chosen so a token survives env files, URLs and copy-paste. */
function toBase62(bytes: Buffer): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  if (n === 0n) return ALPHABET[0] as string;
  let out = '';
  while (n > 0n) {
    out = (ALPHABET[Number(n % 62n)] as string) + out;
    n /= 62n;
  }
  return out;
}

function randomBase62(chars: number): string {
  // Over-sample then trim: base62 is not byte-aligned, so generating extra
  // entropy and cutting is simpler than rejection sampling and never biases the
  // retained characters.
  let out = '';
  while (out.length < chars) out += toBase62(randomBytes(chars));
  return out.slice(0, chars);
}

/** Integrity checksum over the visible token body. NOT a security control. */
function checksum(body: string): string {
  const digest = createHmac('sha256', 'fev-token-checksum').update(body).digest();
  return toBase62(digest)
    .slice(0, CHECKSUM_CHARS)
    .padEnd(CHECKSUM_CHARS, ALPHABET[0] as string);
}

/**
 * HMAC the secret half under the pepper.
 *
 * The pepper MUST come from the secret manager, never from the database: its
 * whole purpose is to be in a different blast radius than the rows it protects.
 */
export function hashSecret(secret: string, pepper: string): string {
  if (pepper.length < 32) {
    throw new Error('API key pepper is too short; refusing to hash with a weak pepper');
  }
  return createHmac('sha256', pepper).update(secret).digest('base64url');
}

/** Mint a new key. The full token is returned once and cannot be recovered later. */
export function mintApiKey(pepper: string, env: KeyEnvironment = 'live'): MintedKey {
  const keyId = randomBase62(KEY_ID_CHARS);
  const secret = toBase62(randomBytes(SECRET_BYTES)).slice(0, 32);
  const body = `${PREFIX}_${env}_${keyId}_${secret}`;
  return { token: `${body}${checksum(body)}`, keyId, secretHash: hashSecret(secret, pepper) };
}

export interface ParsedKey {
  env: KeyEnvironment;
  keyId: string;
  secret: string;
}

/**
 * Parse and checksum-validate a token. Returns null for anything malformed, so
 * a garbage Authorization header costs one string split and no database round
 * trip — the cheap rejection that keeps unauthenticated traffic from reaching
 * our storage at all.
 */
export function parseApiKey(token: string): ParsedKey | null {
  const parts = token.split('_');
  if (parts.length !== 4) return null;
  const [prefix, env, keyId, tail] = parts as [string, string, string, string];
  if (prefix !== PREFIX) return null;
  if (env !== 'live' && env !== 'test') return null;
  if (keyId.length !== KEY_ID_CHARS) return null;
  if (tail.length !== 32 + CHECKSUM_CHARS) return null;

  const secret = tail.slice(0, 32);
  const provided = tail.slice(32);
  const body = `${prefix}_${env}_${keyId}_${secret}`;
  // Constant-time even here: the checksum is not secret, but a length- or
  // content-dependent early exit is a habit worth not forming.
  if (!constantTimeEquals(provided, checksum(body))) return null;

  return { env, keyId, secret };
}

/** Compare two strings without leaking their contents through timing. */
export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still do the work, so a wrong LENGTH is not faster to detect than wrong
    // content; then fail regardless of the comparison's outcome.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Verify a presented secret against the stored hash. */
export function verifySecret(secret: string, storedHash: string, pepper: string): boolean {
  return constantTimeEquals(hashSecret(secret, pepper), storedHash);
}
