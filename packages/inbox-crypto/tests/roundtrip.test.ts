import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { encryptForR2, decryptFromR2 } from '../src/index.js';

describe('encrypt/decrypt round-trip', () => {
  it('decrypts what was encrypted (basic case)', async () => {
    const otp = '123456';
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const plaintext = new TextEncoder().encode('hello inbox');
    const { iv, ciphertext } = await encryptForR2(otp, salt, plaintext);
    const decrypted = await decryptFromR2(otp, salt, iv, ciphertext);
    expect(new TextDecoder().decode(decrypted)).toBe('hello inbox');
  });

  it('property: round-trip preserves arbitrary bytes (numRuns=100)', async () => {
    // Spec F3.5 §3 calls for 10_000 nightly; CI runs 100 to keep PR feedback fast.
    // To run nightly: change numRuns to 10_000.
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 0, maxLength: 4096 }),
        fc.string({ minLength: 1, maxLength: 32 }),
        async (plaintext, otp) => {
          const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
          const { iv, ciphertext } = await encryptForR2(otp, salt, plaintext);
          const decrypted = await decryptFromR2(otp, salt, iv, ciphertext);
          expect(decrypted).toEqual(plaintext);
        }
      ),
      { numRuns: 100 }
    );
  }, 120_000);

  it('different IVs are produced for each encrypt call (random IV)', async () => {
    const otp = '654321';
    const salt = new Uint8Array(16);
    const plaintext = new TextEncoder().encode('same plaintext');
    const a = await encryptForR2(otp, salt, plaintext);
    const b = await encryptForR2(otp, salt, plaintext);
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });
});
