/**
 * Round-trip sign ↔ verify regression suite.
 *
 * P0 (v0.4.4): user reported that PDFs signed in /firmar with a real ArgosData .p12
 * (3DES-encrypted, RSA-2048) come back from /verificar as "Firma inválida" rojo
 * + DEMO banner simultáneamente. v0.3.1 trustInconclusive + v0.3.3 EXPLICIT SET
 * tag fixes do NOT cover this case. Hypothesis: the v0.4.3 forge → PKCS#8 wrap
 * for RSA private keys produces bytes whose imported CryptoKey signs in a way
 * that does NOT match the cert's public key (sigValid=false → status=invalid).
 *
 * This suite signs a minimal PDF with the 3DES-legacy fixture (the closest
 * proxy to a real ArgosData/BCE/Security Data .p12) and runs the full verifier
 * pipeline `verifyPdf` against the result. Expected outcome:
 *   - status === 'warning' (TSL roots empty / placeholder)
 *   - integrity.digestMatches === true
 *   - signer.subjectCN matches the fixture
 *   - and crucially: NO 'invalid' status from sigValid=false
 *
 * If sigValid=false → bug confirmed.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import * as pkijs from 'pkijs';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { parsePfx } from '../src/p12.js';
import { signPdfPades } from '../src/pades.js';
import { verifyPdf } from '../../verifier/src/index.js';

beforeAll(() => {
  pkijs.setEngine(
    'node-webcrypto',
    new pkijs.CryptoEngine({ name: 'node-webcrypto', crypto: webcrypto as unknown as Crypto }),
  );
  if (!(globalThis as { crypto?: Crypto }).crypto) {
    (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
  }
});

const FIX_DIR = join(__dirname, 'fixtures');
const PIN = 'test1234';

// Production-equivalent: TSL has 1+ entry, all placeholders. This matches the
// state when the user reported "Firma inválida" rojo + DEMO banner. Empty
// roots would trigger 'invalid' (chain unverifiable, not a placeholder).
const PLACEHOLDER_ROOTS = [
  {
    slug: 'test-placeholder',
    commonName: 'placeholder',
    orgName: 'placeholder',
    country: 'EC' as const,
    pemContent: '',
    fingerprintSha256: '0'.repeat(64),
    validFrom: '2020-01-01T00:00:00Z',
    validUntil: '2099-01-01T00:00:00Z',
    isPlaceholder: true,
  },
];

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIX_DIR, name)));
}

async function buildMinimalPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('firma.ec round-trip test', { x: 50, y: 100, size: 14, font });
  return doc.save({ useObjectStreams: false });
}

describe('round-trip sign ↔ verify (v0.4.4 P0 regression)', () => {
  it('RSA-2048 valid (AES-256 PFX): signed PDF must verify with sigValid=true', async () => {
    const pfxBytes = loadFixture('rsa2048-valid.p12');
    const pfx = await parsePfx(pfxBytes, PIN);
    const pdf = await buildMinimalPdf();

    const signed = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1]);

    // Use empty trust roots → expect 'warning' (TSL placeholder branch),
    // NOT 'invalid'. The crucial assertion: no_signature path is dodged
    // and crypto checks pass.
    const result = await verifyPdf(signed, { trustRoots: PLACEHOLDER_ROOTS, fetchOcsp: false });

    // Hard requirements: integrity + signature value valid.
    expect(result.integrity?.digestMatches, 'PDF hash must match CMS messageDigest').toBe(true);
    // status MUST NOT be 'invalid' when crypto is sound and roots are empty.
    expect(result.status, 'verify status must not be "invalid"').not.toBe('invalid');
    // signer summary populated
    expect(result.signer?.cert.subject.cn).toBe('Test Signer RSA-2048');
    expect(result.status).toBe('warning');
  });

  it('RSA-2048 3DES legacy (Ecuadorian ECI shape): signed PDF must verify sigValid=true', async () => {
    // Closest possible synthetic proxy to real ArgosData / BCE / Security Data
    // .p12 files. If this round-trip fails, the user-reported bug is confirmed.
    const pfxBytes = loadFixture('rsa2048-3des-legacy.p12');
    const pfx = await parsePfx(pfxBytes, PIN);
    const pdf = await buildMinimalPdf();

    const signed = await signPdfPades(pdf, pfx as Parameters<typeof signPdfPades>[1]);

    const result = await verifyPdf(signed, { trustRoots: PLACEHOLDER_ROOTS, fetchOcsp: false });

    expect(result.integrity?.digestMatches, '3DES-PFX: PDF hash must match CMS messageDigest').toBe(
      true,
    );
    expect(
      result.status,
      '3DES-PFX: verify status must not be "invalid" (would confirm bug)',
    ).not.toBe('invalid');
    expect(result.signer?.cert.subject.cn).toBe('Test Signer 3DES Legacy EC');
    expect(result.status).toBe('warning');
    expect(result.warnings.some((w) => w.code === 'TRUST_PLACEHOLDER')).toBe(true);
  });

  it('Web Crypto cross-check: forge-wrapped privKey signs match cert pubkey', async () => {
    // Direct unit-level guard: extract privKey + cert from a 3DES PFX, sign a
    // known blob with the privKey, verify with the cert's pubkey. If this
    // fails, the PKCS#8 wrap in p12.ts is broken (root cause of round-trip
    // failure).
    const pfxBytes = loadFixture('rsa2048-3des-legacy.p12');
    const pfx = (await parsePfx(pfxBytes, PIN)) as Awaited<ReturnType<typeof parsePfx>> & {
      privateKeyPkcs8Der: ArrayBuffer;
    };

    // Import privKey for RSASSA-PKCS1-v1_5 SHA-256 (most common path).
    const privKey = await crypto.subtle.importKey(
      'pkcs8',
      pfx.privateKeyPkcs8Der,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    // Extract pubkey from the cert DER
    const { default: asn1js } = await import('asn1js');
    const certDer = pfx.signingCert.der;
    const certAb = certDer.buffer.slice(certDer.byteOffset, certDer.byteOffset + certDer.byteLength) as ArrayBuffer;
    const parsed = asn1js.fromBER(certAb);
    expect(parsed.offset).not.toBe(-1);
    const cert = new pkijs.Certificate({ schema: parsed.result });
    const spkiRaw = new Uint8Array(cert.subjectPublicKeyInfo.toSchema().toBER(false));
    const spkiAb = spkiRaw.buffer.slice(spkiRaw.byteOffset, spkiRaw.byteOffset + spkiRaw.byteLength) as ArrayBuffer;
    const pubKey = await crypto.subtle.importKey(
      'spki',
      spkiAb,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const blob = new TextEncoder().encode('firma-ec round-trip canary');
    const sig = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      privKey,
      blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) as ArrayBuffer,
    );
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      pubKey,
      sig,
      blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) as ArrayBuffer,
    );
    expect(ok, 'forge-wrapped PKCS#8 privKey must produce signatures that the cert pubkey verifies').toBe(true);
  });
});
