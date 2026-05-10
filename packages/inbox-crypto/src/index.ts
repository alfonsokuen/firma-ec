/**
 * @firma-ec/inbox-crypto — AES-256-GCM + PBKDF2(600k) for WhatsApp inbox.
 *
 * Used identically server-side (encrypt at webhook → R2) and client-side
 * (decrypt in PWA `/inbox` route). Web Crypto only — no node:crypto import.
 *
 * @see docs/superpowers/specs/2026-05-09-firma-ec-F3.5-whatsapp-inbox-design.md §3
 */

import { deriveKey } from './kdf.js';
import { encrypt, decrypt, type EncryptResult } from './aead.js';

export { deriveKey, deriveRawKeyBytes, PBKDF2_ITERATIONS, KEY_LENGTH_BITS, SALT_LENGTH_BYTES } from './kdf.js';
export { encrypt, decrypt, _encryptWithIv, IV_LENGTH_BYTES } from './aead.js';
export type { EncryptResult } from './aead.js';

/**
 * High-level helper: derive key from OTP+salt and encrypt for R2 storage.
 * Returns IV + ciphertext (caller persists both alongside the salt).
 */
export async function encryptForR2(
  otp: string,
  salt: Uint8Array,
  plaintext: Uint8Array
): Promise<EncryptResult> {
  const key = await deriveKey(otp, salt);
  return encrypt(key, plaintext);
}

/**
 * High-level helper: derive key and decrypt R2 payload.
 * Throws if OTP is wrong, salt mismatched, or ciphertext tampered.
 */
export async function decryptFromR2(
  otp: string,
  salt: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array
): Promise<Uint8Array> {
  const key = await deriveKey(otp, salt);
  return decrypt(key, iv, ciphertext);
}
