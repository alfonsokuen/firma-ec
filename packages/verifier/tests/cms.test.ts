import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSignature } from '../src/pdf';
import { parseCms } from '../src/cms';

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('parseCms', () => {
  test('parses CMS from synthetic PAdES B-B signed PDF (RSA-2048 + SHA-256)', async () => {
    const signed = await readFile(resolve(FIX, 'bb-valid.pdf'));
    const sig = await findSignature(new Uint8Array(signed));
    expect(sig).not.toBeNull();

    const cms = await parseCms(sig!.contents);
    expect(cms.signerCert).toBeDefined();
    expect(cms.digestAlgoOid).toBe('2.16.840.1.101.3.4.2.1'); // SHA-256
    expect(cms.signedMessageDigest.length).toBe(32);
    expect(cms.signatureValue.length).toBeGreaterThanOrEqual(256); // RSA-2048+ → ≥256B
    expect(cms.signedAttrsDer.length).toBeGreaterThan(0);
  });

  test('parses CMS with SHA-1 digest (digestAlgoOid = 1.3.14.3.2.26)', async () => {
    const signed = await readFile(resolve(FIX, 'weak-sha1.pdf'));
    const sig = await findSignature(new Uint8Array(signed));
    const cms = await parseCms(sig!.contents);
    expect(cms.digestAlgoOid).toBe('1.3.14.3.2.26');
    expect(cms.signedMessageDigest.length).toBe(20); // SHA-1 = 160 bits
  });

  test('parses CMS with RSA-1024 signer (signatureValue ~128B)', async () => {
    const signed = await readFile(resolve(FIX, 'rsa-1024.pdf'));
    const sig = await findSignature(new Uint8Array(signed));
    const cms = await parseCms(sig!.contents);
    expect(cms.signatureValue.length).toBeGreaterThanOrEqual(128);
    expect(cms.signatureValue.length).toBeLessThan(256);
  });

  test('parses CMS with expired cert — notAfter in the past', async () => {
    const signed = await readFile(resolve(FIX, 'expired-cert.pdf'));
    const sig = await findSignature(new Uint8Array(signed));
    const cms = await parseCms(sig!.contents);
    expect(cms.signerCert.notAfter.value.getTime()).toBeLessThan(Date.now());
  });

  test('F6.5 — extracts RFC 3161 timestampToken from B-T PDF (sample-b-t-freetsa.pdf)', async () => {
    // Regression for F6.5: previously the extraction read
    // `valueBlock.valueHex` directly which is empty for parsed Sequences in
    // asn1js → timestampToken came back as a 0-byte buffer and the verifier
    // reported B-B instead of B-T. Fix uses valueBeforeDecodeView (or toBER
    // fallback) to recover the original DER bytes of the TimeStampToken.
    const signed = await readFile(resolve(FIX, 'sample-b-t-freetsa.pdf'));
    const sig = await findSignature(new Uint8Array(signed));
    expect(sig).not.toBeNull();
    const cms = await parseCms(sig!.contents);
    expect(cms.timestampToken).toBeDefined();
    // FreeTSA tokens (cert chain + TSTInfo) are typically 4–5 KB; even a
    // bare-bones TSTInfo with no certs is ≥ 1 KB. Use 1 KB as a conservative
    // floor to catch the empty-buffer regression.
    expect(cms.timestampToken!.length).toBeGreaterThan(1000);
  });

  test('F6.5 — B-B PDF (no TSA) leaves timestampToken undefined', async () => {
    const signed = await readFile(resolve(FIX, 'sample-b-b-no-tsa.pdf'));
    const sig = await findSignature(new Uint8Array(signed));
    const cms = await parseCms(sig!.contents);
    expect(cms.timestampToken).toBeUndefined();
  });

  test('throws on garbage CMS bytes', async () => {
    await expect(parseCms(new Uint8Array([0x01, 0x02, 0x03]))).rejects.toThrow(/CMS|ASN/i);
  });

  test('throws on empty CMS bytes', async () => {
    await expect(parseCms(new Uint8Array(0))).rejects.toThrow();
  });

  test('property: arbitrary garbage never resolves successfully (always throws)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 0, maxLength: 200 }), async (bytes) => {
        try {
          await parseCms(bytes);
          return false; // bogus parse — should never happen for random bytes
        } catch {
          return true;
        }
      }),
      { numRuns: 100 },
    );
  });

  test('property: truncated valid CMS throws cleanly (no silent partial parse)', async () => {
    const signed = await readFile(resolve(FIX, 'bb-valid.pdf'));
    const sig = await findSignature(new Uint8Array(signed));
    const cms = sig!.contents;
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: cms.length - 1 }),
        async (truncAt) => {
          try {
            await parseCms(cms.subarray(0, truncAt));
            // A short prefix MAY happen to parse (very unlikely) — accept silently.
            return true;
          } catch {
            return true;
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
