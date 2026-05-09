import { describe, test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { findSignature } from '../src/pdf';
import { parseCms } from '../src/cms';

describe('parseCms', () => {
  // TODO Task 11 — fixture not yet generated
  test.skip('parses CMS from a real PAdES B-B signed PDF', async () => {
    const signed = await readFile('tests/fixtures/security-data-pades-bb.pdf');
    const sig = await findSignature(new Uint8Array(signed));
    expect(sig).not.toBeNull();

    const cms = await parseCms(sig!.contents);
    expect(cms.signerCert).toBeDefined();
    expect(cms.digestAlgoOid).toBe('2.16.840.1.101.3.4.2.1'); // SHA-256
    expect(cms.signedMessageDigest.length).toBe(32);
    expect(cms.signatureValue.length).toBeGreaterThanOrEqual(256); // RSA-2048+
    expect(cms.signedAttrsDer.length).toBeGreaterThan(0);
  });

  test('throws on garbage CMS bytes', async () => {
    await expect(parseCms(new Uint8Array([0x01, 0x02, 0x03]))).rejects.toThrow(/CMS|ASN/i);
  });
});
