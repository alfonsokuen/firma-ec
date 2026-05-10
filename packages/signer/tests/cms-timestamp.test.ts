/**
 * F6 Task 11 — buildCmsSignedData timestamp attachment + fallback.
 *
 * We mock @firma-ec/tsa-client.requestTimestamp to avoid network calls and
 * to deterministically exercise both the happy path (TSToken embedded as
 * unsignedAttr) and the failure paths (timeout, disabled).
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import * as pkijs from 'pkijs';
import * as asn1js from 'asn1js';

// Mock BEFORE importing signer so the cms.ts static import resolves to the mock.
const mockRequestTimestamp = vi.fn();
vi.mock('@firma-ec/tsa-client', async () => {
  const actual = await vi.importActual<typeof import('@firma-ec/tsa-client')>('@firma-ec/tsa-client');
  return {
    ...actual,
    requestTimestamp: (...args: unknown[]) => mockRequestTimestamp(...args),
  };
});

import { parsePfx } from '../src/p12.js';
import { buildCmsSignedData } from '../src/cms.js';
import { importPrivateKey } from '../src/webcrypto.js';

const FIX_DIR = join(__dirname, 'fixtures');
const PIN = 'test1234';
const OID_SIGNATURE_TIMESTAMP_TOKEN = '1.2.840.113549.1.9.16.2.14';

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
  mockRequestTimestamp.mockReset();
});

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIX_DIR, name)));
}

async function setup() {
  const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
  const sigAlg = pfx.sigAlg;
  const messageDigest = new Uint8Array(32);
  for (let i = 0; i < 32; i++) messageDigest[i] = i;
  const privateKey = await importPrivateKey(
    (pfx as unknown as { privateKeyPkcs8Der: ArrayBuffer }).privateKeyPkcs8Der,
    sigAlg,
  );
  return {
    messageDigest,
    signerCertDer: pfx.signingCert.der,
    intermediateCertDers: pfx.intermediates.map((c) => c.der),
    privateKey,
    sigAlg,
    signingTime: new Date('2026-05-09T12:00:00Z'),
  };
}

/** Load the captured FreeTSA TSR fixture and extract the TSToken bytes. */
function loadKatToken(): Uint8Array | null {
  const path = join(__dirname, '..', '..', 'tsa-client', 'tests', '__fixtures__', 'freetsa-kat-2026-05-09.tsr');
  try {
    const tsrBytes = new Uint8Array(readFileSync(path));
    // TimeStampResp ::= SEQUENCE { status PKIStatusInfo, timeStampToken TimeStampToken OPTIONAL }
    // Token = ContentInfo (the second element of the outer SEQUENCE).
    const ab = tsrBytes.buffer.slice(tsrBytes.byteOffset, tsrBytes.byteOffset + tsrBytes.byteLength) as ArrayBuffer;
    const outer = asn1js.fromBER(ab);
    if (outer.offset === -1) return null;
    const seq = outer.result as asn1js.Sequence;
    const items = seq.valueBlock.value;
    if (items.length < 2) return null;
    return new Uint8Array(items[1]!.toBER(false));
  } catch {
    return null;
  }
}

function findUnsignedAttrOid(cmsDer: Uint8Array, oid: string): boolean {
  const ab = cmsDer.buffer.slice(cmsDer.byteOffset, cmsDer.byteOffset + cmsDer.byteLength) as ArrayBuffer;
  const asn = asn1js.fromBER(ab);
  if (asn.offset === -1) return false;
  const ci = new pkijs.ContentInfo({ schema: asn.result });
  const sd = new pkijs.SignedData({ schema: ci.content });
  const si = sd.signerInfos[0]!;
  const attrs = (si as unknown as { unsignedAttrs?: { attributes: { type: string }[] } }).unsignedAttrs?.attributes ?? [];
  return attrs.some((a) => a.type === oid);
}

describe('buildCmsSignedData — F6 timestamp embedding', () => {
  it('skips TSA when timestamp:false; reports reason=disabled', async () => {
    const opts = await setup();
    let received: unknown;
    const result = await buildCmsSignedData({
      ...opts,
      timestamp: false,
      onTimestampResult: (r) => {
        received = r;
      },
    });
    expect(mockRequestTimestamp).not.toHaveBeenCalled();
    expect(result.timestamp.ok).toBe(false);
    expect(result.timestamp.reason).toBe('disabled');
    expect(received).toEqual({ error: 'disabled' });
    expect(findUnsignedAttrOid(result.cms, OID_SIGNATURE_TIMESTAMP_TOKEN)).toBe(false);
  });

  it('falls back to B-B when TSA returns error:timeout', async () => {
    const opts = await setup();
    mockRequestTimestamp.mockResolvedValueOnce({ error: 'timeout', detail: 'mocked' });
    const result = await buildCmsSignedData({ ...opts });
    expect(mockRequestTimestamp).toHaveBeenCalledTimes(1);
    expect(result.timestamp.ok).toBe(false);
    expect(result.timestamp.reason).toBe('timeout');
    expect(findUnsignedAttrOid(result.cms, OID_SIGNATURE_TIMESTAMP_TOKEN)).toBe(false);
  });

  it.runIf(loadKatToken() !== null)(
    'attaches RFC 3161 token as unsignedAttr when TSA returns ok',
    async () => {
      const opts = await setup();
      const token = loadKatToken()!;
      // ParsedCert shape — only the fields cms.ts reads (tsaCert.subjectCN).
      mockRequestTimestamp.mockResolvedValueOnce({
        token,
        tsaUrl: 'https://freetsa.org/tsr',
        hashAlgo: 'SHA-256',
        signingTime: new Date('2026-05-10T04:16:38.845Z'),
        tsaCert: {
          subjectCN: 'www.freetsa.org',
          issuerCN: 'www.freetsa.org',
          der: new Uint8Array(0),
          notBefore: new Date('2016-03-13T01:57:39Z'),
          notAfter: new Date('2026-03-11T01:57:39Z'),
        },
        serialNumberHex: 'aabbccdd',
      });
      const result = await buildCmsSignedData({ ...opts });
      expect(mockRequestTimestamp).toHaveBeenCalledTimes(1);
      // Imprint passed must be SHA-256(signatureValue) → 32 bytes.
      const imprintArg = mockRequestTimestamp.mock.calls[0]![0] as Uint8Array;
      expect(imprintArg).toBeInstanceOf(Uint8Array);
      expect(imprintArg.length).toBe(32);
      expect(result.timestamp.ok).toBe(true);
      expect(result.timestamp.tsaIssuerCN).toBe('www.freetsa.org');
      expect(findUnsignedAttrOid(result.cms, OID_SIGNATURE_TIMESTAMP_TOKEN)).toBe(true);
    },
  );

  it('still returns valid CMS when TSA throws', async () => {
    const opts = await setup();
    mockRequestTimestamp.mockRejectedValueOnce(new Error('boom'));
    const result = await buildCmsSignedData({ ...opts });
    expect(result.timestamp.ok).toBe(false);
    expect(result.timestamp.reason).toBe('network');
    // CMS must still parse cleanly.
    const ab = result.cms.buffer.slice(result.cms.byteOffset, result.cms.byteOffset + result.cms.byteLength) as ArrayBuffer;
    expect(asn1js.fromBER(ab).offset).not.toBe(-1);
  });
});
