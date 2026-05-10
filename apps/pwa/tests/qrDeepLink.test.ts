/**
 * qrDeepLink.test.ts — F6.1 unit tests for the QR deep-link helpers.
 *
 * Runs under Node (vitest default env). `crypto.subtle` is provided by Node
 * 20+ via `globalThis.crypto` — no polyfill needed.
 */
import { describe, it, expect } from 'vitest';
import { parseQrHash, compareHash12 } from '../src/lib/qrDeepLink.ts';

describe('parseQrHash', () => {
  it('returns null for null/undefined/empty input', () => {
    expect(parseQrHash(null)).toBeNull();
    expect(parseQrHash(undefined)).toBeNull();
    expect(parseQrHash('')).toBeNull();
  });

  it('extracts a valid 12-hex hint', () => {
    expect(parseQrHash('h=abc123def456')).toBe('abc123def456');
    expect(parseQrHash('?h=abc123def456')).toBe('abc123def456');
    expect(parseQrHash('t=foo&h=abc123def456')).toBe('abc123def456');
  });

  it('lowercases mixed-case hex', () => {
    expect(parseQrHash('h=ABC123DEF456')).toBe('abc123def456');
  });

  it('returns null when h is absent', () => {
    expect(parseQrHash('t=foo')).toBeNull();
    expect(parseQrHash('?')).toBeNull();
  });

  it('rejects malformed values (non-hex, too long, empty value)', () => {
    expect(parseQrHash('h=zzzzzz')).toBeNull(); // non-hex
    expect(parseQrHash('h=' + 'a'.repeat(33))).toBeNull(); // too long
    expect(parseQrHash('h=')).toBeNull(); // empty value
    expect(parseQrHash('h=ab cd')).toBeNull(); // space
  });

  it('accepts 1..32 hex chars (boundary)', () => {
    expect(parseQrHash('h=a')).toBe('a');
    expect(parseQrHash('h=' + 'a'.repeat(32))).toBe('a'.repeat(32));
  });
});

describe('compareHash12', () => {
  // SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
  // first 12 hex = "2cf24dba5fb0"
  const helloBytes = new TextEncoder().encode('hello');

  it('matches when expected hash matches the first 12 hex of SHA-256', async () => {
    const r = await compareHash12(helloBytes, '2cf24dba5fb0');
    expect(r.match).toBe(true);
    expect(r.computed).toBe('2cf24dba5fb0');
  });

  it('mismatches when expected differs', async () => {
    const r = await compareHash12(helloBytes, '000000000000');
    expect(r.match).toBe(false);
    expect(r.computed).toBe('2cf24dba5fb0');
  });

  it('accepts ArrayBuffer input as well as Uint8Array', async () => {
    const ab = helloBytes.buffer.slice(
      helloBytes.byteOffset,
      helloBytes.byteOffset + helloBytes.byteLength,
    ) as ArrayBuffer;
    const r = await compareHash12(ab, '2cf24dba5fb0');
    expect(r.match).toBe(true);
  });

  it('compares the prefix when expected is shorter than 12', async () => {
    const r = await compareHash12(helloBytes, '2cf2');
    expect(r.match).toBe(true);
    expect(r.computed).toBe('2cf24dba5fb0');
  });
});
