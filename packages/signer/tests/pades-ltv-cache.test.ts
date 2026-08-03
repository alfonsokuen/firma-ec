/**
 * F-batch — LTV cache reuse across multiple signPdfPades calls sharing the
 * same certificate chain (batch-signing session use case).
 *
 * INTEGRATION test: nothing in the LTV path is mocked. `fetchOcsp` — the unit
 * that owns the cache — runs for real; the only thing faked is the network
 * boundary (`globalThis.fetch`), which answers with a genuine CA-signed
 * OCSPResponse echoing the request's CertID. So `networkCalls` is direct
 * evidence of a cache hit or miss, not an artefact of a fake that reimplements
 * the behaviour under test.
 *
 * (An earlier version of this file mocked `fetchOcsp` with a cache-aware fake
 * that did the `.get()`/`.set()` itself. It passed while production code never
 * read the cache at all — a false green. The hit/miss corpus that pins
 * `fetchOcsp`'s own contract, including the `nextUpdate` freshness bound, lives
 * in `packages/ltv-validation/tests/ocsp-cache-integration.test.ts`.)
 *
 * What THIS file proves, end to end through `signPdfPades`:
 *   - 3 documents + ONE shared `ocspCache` ⇒ exactly ONE OCSP round trip.
 *   - the same 3 documents with NO cache ⇒ 3 round trips (the baseline that
 *     makes the assertion above meaningful).
 */

import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOcspCache } from '@firma-ec/ltv-validation';
import forge from 'node-forge';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pkijs from 'pkijs';
// Shared synthetic-PKI helpers (CA + leaf, signed OCSP responder answers).
// Test-only cross-package import — neither package typechecks `tests/**`.
import { makeSignedOcspResponseDer } from '../../ltv-validation/tests/helpers/synthCerts.js';
import { parsePfx } from '../src/p12.js';
import { signPdfPades } from '../src/pades.js';

const PIN = 'test1234';
const OCSP_URL = 'http://ocsp.test.invalid/';
const HOUR_MS = 60 * 60 * 1000;

beforeAll(() => {
  pkijs.setEngine(
    'node-webcrypto',
    new pkijs.CryptoEngine({ name: 'node-webcrypto', crypto: webcrypto as unknown as Crypto }),
  );
  if (!(globalThis as { crypto?: Crypto }).crypto) {
    (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
  }
});

/** Self-signed CA + leaf, packaged as a PKCS#12 the signer can open. */
interface SynthP12 {
  p12: Uint8Array;
  caCert: forge.pki.Certificate;
  caKey: forge.pki.rsa.PrivateKey;
}

function makeSynthP12(): SynthP12 {
  const caKeys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const leafKeys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const now = Date.now();

  const caAttrs = [
    { name: 'commonName', value: 'TEST-BATCH-CA' },
    { name: 'countryName', value: 'EC' },
  ];
  const caCert = forge.pki.createCertificate();
  caCert.publicKey = caKeys.publicKey;
  caCert.serialNumber = '01';
  caCert.validity.notBefore = new Date(now - 86_400_000);
  caCert.validity.notAfter = new Date(now + 365 * 86_400_000);
  caCert.setSubject(caAttrs);
  caCert.setIssuer(caAttrs);
  caCert.setExtensions([
    { name: 'basicConstraints', cA: true } as forge.pki.CertificateExtension,
    {
      name: 'keyUsage',
      keyCertSign: true,
      cRLSign: true,
      digitalSignature: true,
    } as forge.pki.CertificateExtension,
    { name: 'subjectKeyIdentifier' } as forge.pki.CertificateExtension,
  ]);
  caCert.sign(caKeys.privateKey, forge.md.sha256.create());

  const leafCert = forge.pki.createCertificate();
  leafCert.publicKey = leafKeys.publicKey;
  leafCert.serialNumber = '02ab';
  leafCert.validity.notBefore = new Date(now - 86_400_000);
  leafCert.validity.notAfter = new Date(now + 180 * 86_400_000);
  leafCert.setSubject([
    { name: 'commonName', value: 'TEST-BATCH-LEAF' },
    { name: 'countryName', value: 'EC' },
  ]);
  leafCert.setIssuer(caAttrs);
  leafCert.setExtensions([
    { name: 'basicConstraints', cA: false } as forge.pki.CertificateExtension,
    {
      name: 'keyUsage',
      digitalSignature: true,
      nonRepudiation: true,
    } as forge.pki.CertificateExtension,
    { name: 'subjectKeyIdentifier' } as forge.pki.CertificateExtension,
  ]);
  leafCert.sign(caKeys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(leafKeys.privateKey, [leafCert, caCert], PIN, {
    algorithm: 'aes256',
  });
  const der = forge.asn1.toDer(p12Asn1).getBytes();
  const out = new Uint8Array(der.length);
  for (let i = 0; i < der.length; i++) out[i] = der.charCodeAt(i) & 0xff;
  return { p12: out, caCert, caKey: caKeys.privateKey };
}

/**
 * Stub the network with a responder that answers every OCSP POST with a real
 * signed response valid for the next hour. Returns a counter of round trips.
 */
function installFakeResponder(synth: SynthP12): { calls: () => number } {
  let calls = 0;
  const now = Date.now();
  vi.stubGlobal('fetch', async (_input: unknown, init?: RequestInit) => {
    calls += 1;
    const body = init?.body as ArrayBuffer;
    const der = makeSignedOcspResponseDer({
      requestDer: new Uint8Array(body),
      caCert: synth.caCert,
      caKey: synth.caKey,
      thisUpdate: new Date(now - 60_000),
      nextUpdate: new Date(now + HOUR_MS),
    });
    return new Response(der, {
      status: 200,
      headers: { 'Content-Type': 'application/ocsp-response' },
    });
  });
  return { calls: () => calls };
}

let synth: SynthP12;

beforeAll(() => {
  synth = makeSynthP12();
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function buildMinimalPdf(label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(`LTV cache fixture ${label}`, { x: 50, y: 100, size: 14, font });
  return doc.save({ useObjectStreams: false });
}

describe('signPdfPades — LTV cache reuse (batch session)', () => {
  it('signing 3 PDFs with the same cert + shared ocspCache hits the OCSP responder ONCE, not once per doc', async () => {
    const responder = installFakeResponder(synth);
    const pfx = await parsePfx(synth.p12, PIN);
    const sharedOcspCache = createOcspCache();

    for (const label of ['a', 'b', 'c']) {
      const pdf = await buildMinimalPdf(label);
      const result = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
        timestamp: false,
        ltv: {
          longTermArchive: false,
          ocspUrl: OCSP_URL,
          ocspCache: sharedOcspCache,
        },
      });
      // Every document must still end up with real revocation data embedded —
      // a cache hit is only useful if it produces the same signed output.
      expect(result.ltv.longTermAchieved).toBe(true);
      expect(result.ltv.embeddedOcspCount).toBe(1);
    }

    expect(responder.calls()).toBe(1);
    expect(sharedOcspCache.size).toBe(1);
  });

  it('without a shared cache, each signPdfPades call re-queries the responder (baseline / regression guard)', async () => {
    const responder = installFakeResponder(synth);
    const pfx = await parsePfx(synth.p12, PIN);

    for (const label of ['x', 'y', 'z']) {
      const pdf = await buildMinimalPdf(label);
      const result = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1], {
        timestamp: false,
        ltv: { longTermArchive: false, ocspUrl: OCSP_URL }, // no cache passed
      });
      expect(result.ltv.longTermAchieved).toBe(true);
    }

    expect(responder.calls()).toBe(3);
  });
});
