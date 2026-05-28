/**
 * qrDeepLink.test.ts — F6.1 unit tests for the QR deep-link helpers.
 *
 * Runs under Node (vitest default env). `crypto.subtle` is provided by Node
 * 20+ via `globalThis.crypto` — no polyfill needed.
 */
import { describe, expect, it } from 'vitest';
import { parseQrHash } from '../src/lib/qrDeepLink.ts';

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
