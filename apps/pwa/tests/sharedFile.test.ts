/**
 * sharedFile.test.ts — round-trip unit tests for the OS-share PDF handoff.
 *
 * Runs under Node (vitest default env). We polyfill a tiny in-memory
 * sessionStorage + atob/btoa so the module under test runs unmodified.
 */
import { beforeEach, describe, expect, it } from 'vitest';

// In-memory sessionStorage polyfill — defined before importing the module
// under test so the module captures it on first call (it reads it lazily).
class MemStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return Array.from(this.map.keys())[i] ?? null;
  }
}

(globalThis as unknown as { sessionStorage: Storage }).sessionStorage =
  new MemStorage() as unknown as Storage;
if (typeof (globalThis as unknown as { atob?: unknown }).atob !== 'function') {
  (globalThis as unknown as { atob: (s: string) => string }).atob = (s: string) =>
    Buffer.from(s, 'base64').toString('binary');
  (globalThis as unknown as { btoa: (s: string) => string }).btoa = (s: string) =>
    Buffer.from(s, 'binary').toString('base64');
}

const { stash, consume, hasPending } = await import('../src/lib/sharedFile.ts');

describe('sharedFile handoff', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('round-trips a small Uint8Array intact', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
    stash(bytes, 'invoice.pdf');
    expect(hasPending()).toBe(true);

    const out = consume();
    expect(out).not.toBeNull();
    expect(out?.name).toBe('invoice.pdf');
    expect(Array.from(out?.bytes ?? [])).toEqual(Array.from(bytes));
    // consume() must clear the entry — second call returns null.
    expect(consume()).toBeNull();
    expect(hasPending()).toBe(false);
  });

  it('handles a chunk-boundary payload (>32KB) without stack overflow', () => {
    const size = 0x8000 * 2 + 17; // 65553 bytes — straddles two chunk windows
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i & 0xff;
    stash(bytes, 'big.pdf');

    const out = consume();
    expect(out?.bytes.byteLength).toBe(size);
    expect(out?.bytes[0]).toBe(0);
    expect(out?.bytes[size - 1]).toBe((size - 1) & 0xff);
    expect(out?.bytes[0x8000]).toBe(0); // 0x8000 % 256 === 0
  });

  it('returns null when nothing is pending', () => {
    expect(consume()).toBeNull();
    expect(hasPending()).toBe(false);
  });

  it('survives sessionStorage corruption (bad base64) without throwing', () => {
    sessionStorage.setItem('__incomingPdf', '!!!not-base64!!!');
    sessionStorage.setItem('__incomingPdfName', 'broken.pdf');
    // Should return null rather than throw — module catches decode errors.
    expect(() => consume()).not.toThrow();
  });
});
