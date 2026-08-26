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
const SECRET_CHARS = 32; // 32 x log2(62) ~= 190 bits
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

/**
 * Encode bytes as base62, LEFT-PADDED to a fixed width.
 *
 * The padding is not cosmetic. Without it the output shrinks whenever the
 * leading bytes are small, which silently produced short secrets: measured,
 * 0.62% of minted tokens came out 30-31 characters instead of 32 and were then
 * rejected by our own parser. The holder saw a 401 indistinguishable from an
 * unknown key, so the defect looked like their mistake.
 */
function toBase62(bytes: Buffer, width: number): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = (ALPHABET[Number(n % 62n)] as string) + out;
    n /= 62n;
  }
  return out.padStart(width, ALPHABET[0] as string);
}

/**
 * Uniform base62 string, one character at a time by rejection sampling.
 *
 * 256 is not a multiple of 62, so `byte % 62` favours the first 8 letters.
 * Discarding the top 8 values leaves 248 = 4 x 62, which is exact. Encoding a
 * big integer instead would bias the LEADING character for the same reason
 * (measured: 3.63 bits of entropy there versus 5.95 elsewhere).
 */
function randomBase62(chars: number): string {
  const LIMIT = 248;
  let out = '';
  while (out.length < chars) {
    for (const b of randomBytes(chars * 2)) {
      if (b >= LIMIT) continue;
      out += ALPHABET[b % 62] as string;
      if (out.length === chars) break;
    }
  }
  return out;
}

/** Integrity checksum over the visible token body. NOT a security control. */
function checksum(body: string): string {
  const digest = createHmac('sha256', 'fev-token-checksum').update(body).digest();
  return toBase62(digest, CHECKSUM_CHARS).slice(-CHECKSUM_CHARS);
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
  const secret = randomBase62(SECRET_CHARS);
  const body = `${PREFIX}_${env}_${keyId}_${secret}`;
  const token = `${body}${checksum(body)}`;
  // Verify our own output before handing it out. A key that cannot be parsed
  // back is worse than a failed mint: it fails later, at the holder, as an
  // ordinary 401 that looks like their fault.
  if (parseApiKey(token) === null) {
    throw new Error('minted an unparseable API key; refusing to issue it');
  }
  return { token, keyId, secretHash: hashSecret(secret, pepper) };
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
  if (tail.length !== SECRET_CHARS + CHECKSUM_CHARS) return null;

  const secret = tail.slice(0, SECRET_CHARS);
  const provided = tail.slice(SECRET_CHARS);
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
