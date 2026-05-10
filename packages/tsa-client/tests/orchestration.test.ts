import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { requestTimestamp } from '../src/index';

const FIXTURE_TSR = resolve(__dirname, '__fixtures__/freetsa-kat-2026-05-09.tsr');
const FIXTURE_META = resolve(__dirname, '__fixtures__/freetsa-kat-2026-05-09.meta.json');
const HAS_KAT = existsSync(FIXTURE_TSR) && existsSync(FIXTURE_META);

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requestTimestamp orchestration', () => {
  it('returns error:network on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('connection refused');
    }));
    const r = await requestTimestamp(new Uint8Array(32), { url: 'https://freetsa.org/tsr' });
    expect(r).toMatchObject({ error: 'network' });
  });

  it('returns error:timeout when fetch is aborted', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      // Simulate hang until aborted.
      return await new Promise<Response>((_resolve, reject) => {
        const sig = init.signal;
        if (sig) {
          if (sig.aborted) {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
            return;
          }
          sig.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }
      });
    }));
    const r = await requestTimestamp(new Uint8Array(32), { url: 'https://freetsa.org/tsr', timeoutMs: 50 });
    expect(r).toMatchObject({ error: 'timeout' });
  });

  it('returns error:rate_limited on HTTP 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429, statusText: 'Too Many Requests' })));
    const r = await requestTimestamp(new Uint8Array(32), { url: 'https://freetsa.org/tsr' });
    expect(r).toMatchObject({ error: 'rate_limited' });
  });

  it.skipIf(!HAS_KAT)('returns malformed when fixture imprint mismatches request imprint', async () => {
    // Mock fetch to return the captured KAT — but supply a different imprint to requestTimestamp
    // → verifyResponseAgainstRequest should flag imprint_mismatch.
    const tsr = readFileSync(FIXTURE_TSR);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(tsr, { status: 200 })));
    const wrongImprint = new Uint8Array(32); // all zeros
    const r = await requestTimestamp(wrongImprint, { url: 'https://freetsa.org/tsr' });
    expect(r).toMatchObject({ error: 'malformed' });
    if ('error' in r) expect(r.detail).toMatch(/imprint_mismatch|nonce_mismatch/);
  });

  it.skipIf(!HAS_KAT)('returns TimestampOk when fixture matches captured imprint+nonce', async () => {
    // To bypass the random nonce, we have to stub crypto.getRandomValues to seed
    // the same nonce as in the fixture meta.
    const meta = JSON.parse(readFileSync(FIXTURE_META, 'utf-8')) as { imprintHex: string; nonceHex: string };
    const fixedNonce = hexToBytes(meta.nonceHex);
    const fixedImprint = hexToBytes(meta.imprintHex);
    const tsr = readFileSync(FIXTURE_TSR);

    const realRandom = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((u: Uint8Array) => {
      // First call (in requestTimestamp) is the 8-byte nonce; seed it to match fixture.
      if (u.byteLength === fixedNonce.byteLength) {
        u.set(fixedNonce);
        return u;
      }
      return realRandom(u as Parameters<typeof realRandom>[0]);
    }) as typeof globalThis.crypto.getRandomValues);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(tsr, { status: 200 })));
    const r = await requestTimestamp(fixedImprint, { url: 'https://freetsa.org/tsr' });
    expect('token' in r).toBe(true);
    if ('token' in r) {
      expect(r.tsaUrl).toBe('https://freetsa.org/tsr');
      expect(r.signingTime).toBeInstanceOf(Date);
      expect(r.tsaCert.subjectCN).toBeTruthy();
      expect(r.serialNumberHex.length).toBeGreaterThan(0);
    }
  });
});
