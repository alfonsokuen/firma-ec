/**
 * PBKDF2 key derivation for inbox encryption.
 *
 * Spec: F3.5 §3 — PBKDF2-SHA256, 600,000 iterations → AES-256-GCM key.
 * Identical code runs server-side (Node 22 webcrypto) and client-side (browser).
 */

export const PBKDF2_ITERATIONS = 600_000;
export const KEY_LENGTH_BITS = 256;
export const SALT_LENGTH_BYTES = 16;

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();

/**
 * Derive an AES-GCM 256 CryptoKey from an OTP and salt via PBKDF2-SHA256.
 *
 * @param otp - One-time password string (e.g. 6-digit code).
 * @param salt - Random salt (>=16 bytes recommended).
 */
export async function deriveKey(otp: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await subtle.importKey('raw', encoder.encode(otp), { name: 'PBKDF2' }, false, [
    'deriveKey',
    'deriveBits',
  ]);
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: KEY_LENGTH_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Derive raw key bytes (32 bytes for AES-256) — exposed for known-answer tests.
 * Production callers should use {@link deriveKey} which returns an opaque CryptoKey.
 */
export async function deriveRawKeyBytes(otp: string, salt: Uint8Array): Promise<Uint8Array> {
  const baseKey = await subtle.importKey('raw', encoder.encode(otp), { name: 'PBKDF2' }, false, [
    'deriveBits',
  ]);
  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    KEY_LENGTH_BITS,
  );
  return new Uint8Array(bits);
}
