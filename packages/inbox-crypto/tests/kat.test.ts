import { describe, it, expect } from 'vitest';
import { deriveRawKeyBytes, deriveKey } from '../src/kdf.js';
import { decrypt } from '../src/aead.js';

/**
 * Known-answer tests pinning PBKDF2 + AES-GCM parameters.
 * If these fail, the KDF or cipher contract changed — bump a major version
 * and migrate all stored R2 payloads.
 */

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe('KAT — deterministic vectors', () => {
  // salt = 0x00..0x0f
  const salt = new Uint8Array(16);
  for (let i = 0; i < 16; i++) salt[i] = i;

  it('deriveRawKeyBytes(otp="123456", salt=0x00..0x0f) matches frozen vector', async () => {
    const expected = '93922e39f17be3ac82ee49e41b689b2f825ffcb9b18c64406350c92b4fa3c59c';
    const got = await deriveRawKeyBytes('123456', salt);
    expect(hex(got)).toBe(expected);
  });

  it('AES-GCM decrypt with frozen iv+ct returns "hello"', async () => {
    // iv = 0xa0..0xab (12 bytes)
    const iv = new Uint8Array(12);
    for (let i = 0; i < 12; i++) iv[i] = 0xa0 + i;
    const ciphertext = fromHex('df251d9172dc83fdeb4252c37ffb7ab28bfad3e84a');
    const key = await deriveKey('123456', salt);
    const plaintext = await decrypt(key, iv, ciphertext);
    expect(new TextDecoder().decode(plaintext)).toBe('hello');
  });
});
