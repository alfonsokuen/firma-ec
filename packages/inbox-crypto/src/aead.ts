/**
 * AES-256-GCM authenticated encryption.
 *
 * Spec: F3.5 §3 — IV 12 bytes random per message, auth tag 128-bit
 * (appended to ciphertext by Web Crypto, verified on decrypt).
 */

export const IV_LENGTH_BYTES = 12;

const subtle = globalThis.crypto.subtle;

export interface EncryptResult {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

/**
 * Encrypt plaintext with a random 12-byte IV.
 * The auth tag (16 bytes) is appended to the returned ciphertext.
 */
export async function encrypt(key: CryptoKey, plaintext: Uint8Array): Promise<EncryptResult> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  return _encryptWithIv(key, plaintext, iv);
}

/**
 * Internal: encrypt with a caller-provided IV. Exposed for deterministic tests.
 * Production code MUST use {@link encrypt} (random IV).
 */
export async function _encryptWithIv(
  key: CryptoKey,
  plaintext: Uint8Array,
  iv: Uint8Array
): Promise<EncryptResult> {
  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error(`IV must be ${IV_LENGTH_BYTES} bytes, got ${iv.length}`);
  }
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext as BufferSource
  );
  return { iv, ciphertext: new Uint8Array(ct) };
}

/**
 * Decrypt + verify auth tag. Throws if tampered (Web Crypto rejects on bad tag).
 */
export async function decrypt(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array
): Promise<Uint8Array> {
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource
  );
  return new Uint8Array(pt);
}
