import { describe, expect, it } from 'vitest';
import { createCrlCache, createOcspCache, crlCacheKey, ocspCacheKey } from '../src/cache';
import type { CrlResult, OcspResult } from '../src/types';

const fakeOcsp = (status: 'good' | 'revoked' | 'unknown' = 'good'): OcspResult => ({
  ok: true,
  responseDer: new Uint8Array([0x30, 0x00]),
  status,
  producedAt: new Date(),
  thisUpdate: new Date(),
  responderUrl: 'http://x',
  signatureValid: true,
});

describe('OCSP cache', () => {
  it('set then get returns the value', () => {
    const c = createOcspCache();
    c.set('k', fakeOcsp('good'));
    expect(c.get('k')?.status).toBe('good');
  });

  it('expired entries return undefined', async () => {
    const c = createOcspCache(1); // TTL 1ms
    c.set('k', fakeOcsp());
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(c.get('k')).toBeUndefined();
  });

  it('clear empties the cache', () => {
    const c = createOcspCache();
    c.set('a', fakeOcsp());
    c.set('b', fakeOcsp());
    c.clear();
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBeUndefined();
  });

  it('LRU eviction caps at maxEntries', () => {
    const c = createOcspCache(60_000, 3);
    c.set('a', fakeOcsp());
    c.set('b', fakeOcsp());
    c.set('c', fakeOcsp());
    c.set('d', fakeOcsp()); // evicts oldest 'a'
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBeDefined();
    expect(c.get('c')).toBeDefined();
    expect(c.get('d')).toBeDefined();
  });
});

describe('CRL cache', () => {
  it('createCrlCache works the same way', () => {
    const c = createCrlCache(60_000, 5);
    const fake: CrlResult = {
      ok: true,
      crlDer: new Uint8Array([0x30, 0x00]),
      // Doble de pruebas: la CRL no se lee en este caso.
      crl: {} as never,
      thisUpdate: new Date(),
      distributionPointUrl: 'http://x',
    };
    c.set('k', fake);
    expect(c.get('k')?.distributionPointUrl).toBe('http://x');
  });
});

describe('cache keys', () => {
  it('ocspCacheKey is deterministic and 64 hex chars (SHA-256)', async () => {
    const k1 = await ocspCacheKey('02ab', 'deadbeef');
    const k2 = await ocspCacheKey('02ab', 'deadbeef');
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different inputs collide-resistantly produce different keys', async () => {
    const a = await ocspCacheKey('02ab', 'deadbeef');
    const b = await ocspCacheKey('02ac', 'deadbeef');
    const c = await ocspCacheKey('02ab', 'deadbeec');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it('crlCacheKey hashes the URL', async () => {
    const a = await crlCacheKey('http://crl.example.com/a.crl');
    const b = await crlCacheKey('http://crl.example.com/b.crl');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
