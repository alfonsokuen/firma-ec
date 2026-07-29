/**
 * F-batch — LTV cache reuse across multiple signPdfPades calls sharing the
 * same certificate chain (batch-signing session use case).
 *
 * `collectLtvData` already accepts `ocspCache`/`crlCache` (see ltv.ts) and
 * `@firma-ec/ltv-validation` already ships TTL-respecting in-memory caches
 * (`createOcspCache`/`createCrlCache`, 1h/6h TTL, unit-tested in
 * `packages/ltv-validation/tests/cache.test.ts`). What THIS test proves is
 * the integration seam: `signPdfPades` (via `LtvOpts.ocspCache`) threads a
 * caller-supplied cache object through `collectLtvData` → `fetchOcsp` intact
 * and keyed consistently, so a batch session can build ONE cache per opened
 * .p12 and reuse it across N documents.
 *
 * We don't re-verify fetchOcsp's own cache hit/miss logic here (that's
 * ltv-validation's job) — instead `mockFetchOcsp` is a cache-aware fake that
 * reads/writes whatever `cache` object it's handed, so the assertion is
 * purely about whether the SAME cache instance survives 3 separate
 * `signPdfPades` calls without being dropped or re-created.
 */

import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OcspCache, OcspResult } from '@firma-ec/ltv-validation';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pkijs from 'pkijs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const mockFetchOcsp = vi.fn();
const mockFetchCrl = vi.fn();

vi.mock('@firma-ec/ltv-validation', async () => {
  const actual = await vi.importActual<typeof import('@firma-ec/ltv-validation')>(
    '@firma-ec/ltv-validation',
  );
  return {
    ...actual,
    fetchOcsp: (...args: unknown[]) => mockFetchOcsp(...args),
    fetchCrl: (...args: unknown[]) => mockFetchCrl(...args),
  };
});

import { createOcspCache } from '@firma-ec/ltv-validation';
import { parsePfx } from '../src/p12.js';
import { signPdfPades } from '../src/pades.js';

let networkCallCount = 0;

/**
 * Cache-aware fake for fetchOcsp: mirrors the real contract (checks
 * `opts.cache` first, falls back to "network" + populates the cache) without
 * needing a real ASN.1-encoded, responder-signed OCSP response. Keyed by
 * subjectCN since every fixture doc in this suite reuses the same signer.
 */
function installCacheAwareFetchOcspFake(): void {
  mockFetchOcsp.mockImplementation(
    async (cert: { subjectCN?: string | null }, _issuer: unknown, opts?: { cache?: OcspCache }) => {
      const key = cert.subjectCN ?? 'unknown-cn';
      const cached = opts?.cache?.get(key);
      if (cached) return cached;
      networkCallCount += 1;
      const result: OcspResult = {
        ok: true,
        responseDer: fakeOcspResponse(),
        status: 'good',
        producedAt: new Date(),
        thisUpdate: new Date(),
        responderUrl: 'http://ocsp.example/',
        signatureValid: true,
      };
      opts?.cache?.set(key, result);
      return result;
    },
  );
}

const FIX_DIR = join(__dirname, 'fixtures');
const PIN = 'test1234';

beforeAll(() => {
  pkijs.setEngine(
    'node-webcrypto',
    new pkijs.CryptoEngine({ name: 'node-webcrypto', crypto: webcrypto as unknown as Crypto }),
  );
  if (!(globalThis as { crypto?: Crypto }).crypto) {
    (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
  }
});

afterEach(() => {
  mockFetchOcsp.mockReset();
  mockFetchCrl.mockReset();
  networkCallCount = 0;
});

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIX_DIR, name)));
}

async function buildMinimalPdf(label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(`LTV cache fixture ${label}`, { x: 50, y: 100, size: 14, font });
  return doc.save({ useObjectStreams: false });
}

function fakeOcspResponse(): Uint8Array {
  return new Uint8Array([0x30, 0x82, 0x01, 0x00, 0xaa, 0xbb, 0xcc, 0xdd]);
}

describe('signPdfPades — LTV cache reuse (batch session)', () => {
  it('signing 3 PDFs with the same cert + shared ocspCache hits the network once, not once per doc', async () => {
    installCacheAwareFetchOcspFake();

    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const sharedOcspCache = createOcspCache();

    for (const label of ['a', 'b', 'c']) {
      const pdf = await buildMinimalPdf(label);
      const result = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
        timestamp: false,
        ltv: { longTermArchive: false, ocspCache: sharedOcspCache },
      });
      expect(result.ltv.longTermAchieved).toBe(true);
    }

    // First document populates the cache (1 real "network" hit); the other
    // two must have hit the shared cache instead of calling fetchOcsp's
    // network path again.
    expect(networkCallCount).toBe(1);
    expect(mockFetchOcsp).toHaveBeenCalledTimes(3); // still called 3x, but 2 are cache hits
    expect(sharedOcspCache.size).toBeGreaterThan(0);
  });

  it('without a shared cache, each signPdfPades call re-fetches OCSP (baseline / regression guard)', async () => {
    installCacheAwareFetchOcspFake();

    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);

    for (const label of ['x', 'y']) {
      const pdf = await buildMinimalPdf(label);
      await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
        timestamp: false,
        ltv: { longTermArchive: false }, // no cache passed → each call "hits the network"
      });
    }

    expect(networkCallCount).toBe(2);
  });
});
