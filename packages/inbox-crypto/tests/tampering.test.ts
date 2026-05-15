import { describe, expect, it } from 'vitest';
import { decryptFromR2, encryptForR2 } from '../src/index.js';

describe('AES-GCM tampering detection', () => {
  it('flipping a single ciphertext byte makes decrypt throw', async () => {
    const otp = '987654';
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const plaintext = new TextEncoder().encode('integrity matters');
    const { iv, ciphertext } = await encryptForR2(otp, salt, plaintext);

    const tampered = new Uint8Array(ciphertext);
    tampered[0] ^= 0x01;

    await expect(decryptFromR2(otp, salt, iv, tampered)).rejects.toThrow();
  });

  it('flipping a byte in the auth tag (last 16 bytes) makes decrypt throw', async () => {
    const otp = 'tagcheck';
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const plaintext = new TextEncoder().encode('payload');
    const { iv, ciphertext } = await encryptForR2(otp, salt, plaintext);

    const tampered = new Uint8Array(ciphertext);
    const lastIdx = tampered.length - 1;
    if (lastIdx < 0) throw new Error('expected non-empty ciphertext');
    // biome-ignore lint/style/noNonNullAssertion: index range checked above
    tampered[lastIdx] = (tampered[lastIdx]! ^ 0xff) & 0xff;

    await expect(decryptFromR2(otp, salt, iv, tampered)).rejects.toThrow();
  });

  it('wrong OTP makes decrypt throw', async () => {
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const plaintext = new TextEncoder().encode('secret');
    const { iv, ciphertext } = await encryptForR2('111111', salt, plaintext);

    await expect(decryptFromR2('222222', salt, iv, ciphertext)).rejects.toThrow();
  });

  it('wrong salt makes decrypt throw', async () => {
    const otp = 'samepass';
    const saltA = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const saltB = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const plaintext = new TextEncoder().encode('secret');
    const { iv, ciphertext } = await encryptForR2(otp, saltA, plaintext);

    await expect(decryptFromR2(otp, saltB, iv, ciphertext)).rejects.toThrow();
  });
});
