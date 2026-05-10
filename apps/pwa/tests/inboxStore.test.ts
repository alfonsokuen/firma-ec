/**
 * inboxStore.test.ts — F3.5 inbox memory state + idle re-prompt logic.
 *
 * The store uses Svelte 5 `$state` runes which require the .svelte.ts
 * compiler. To keep these tests pure-Node and dependency-free we exercise
 * the persistence-side via the public API; the in-memory $state piece is
 * trivially asserted via setContext/getContext round-trip.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// In-memory localStorage polyfill.
class MemStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, String(v)); }
  removeItem(k: string): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
  get length(): number { return this.map.size; }
  key(i: number): string | null { return Array.from(this.map.keys())[i] ?? null; }
}

(globalThis as unknown as { localStorage: Storage }).localStorage = new MemStorage() as unknown as Storage;

const {
  setContext,
  getContext,
  clear,
  touch,
  isIdleExpired,
  clearIdleStamp,
} = await import('../src/lib/inboxStore.ts');

describe('inboxStore', () => {
  beforeEach(() => {
    clear();
    clearIdleStamp();
  });

  it('round-trips an InboxContext via setContext/getContext', () => {
    expect(getContext()).toBeNull();
    setContext({ pdfId: 'p1', jwt: 'JWT', otp: '123456', source: 'inbox' });
    const ctx = getContext();
    expect(ctx).not.toBeNull();
    expect(ctx?.pdfId).toBe('p1');
    expect(ctx?.jwt).toBe('JWT');
    expect(ctx?.source).toBe('inbox');
  });

  it('clear() drops the in-memory context', () => {
    setContext({ pdfId: 'p1', jwt: 'JWT', otp: '123456', source: 'inbox' });
    clear();
    expect(getContext()).toBeNull();
  });

  it('touch() writes a numeric timestamp to localStorage', () => {
    touch();
    const raw = localStorage.getItem('firma_ec_inbox_last_active');
    expect(raw).not.toBeNull();
    expect(Number.isFinite(Number(raw))).toBe(true);
  });

  it('isIdleExpired() returns false when no stamp recorded', () => {
    expect(isIdleExpired()).toBe(false);
  });

  it('isIdleExpired() returns false right after touch()', () => {
    touch();
    expect(isIdleExpired()).toBe(false);
  });

  it('isIdleExpired() returns true when last_active is older than 10min', () => {
    const eleven_min_ago = Date.now() - 11 * 60 * 1000;
    localStorage.setItem('firma_ec_inbox_last_active', String(eleven_min_ago));
    expect(isIdleExpired()).toBe(true);
  });

  it('isIdleExpired() returns true on corrupted stamp', () => {
    localStorage.setItem('firma_ec_inbox_last_active', 'not-a-number');
    expect(isIdleExpired()).toBe(true);
  });

  it('clearIdleStamp() removes the persisted timestamp', () => {
    touch();
    clearIdleStamp();
    expect(localStorage.getItem('firma_ec_inbox_last_active')).toBeNull();
  });

  it('does NOT persist JWT or OTP in any storage', () => {
    setContext({ pdfId: 'p1', jwt: 'JWT-secret', otp: '999999', source: 'inbox' });
    touch();
    // Walk every key in localStorage; none should leak the JWT or OTP value.
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const v = localStorage.getItem(k) ?? '';
      expect(v.includes('JWT-secret')).toBe(false);
      expect(v.includes('999999')).toBe(false);
    }
  });
});
