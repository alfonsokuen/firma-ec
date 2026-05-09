/**
 * Regression tests for v0.3.3 — real ECI PDFs from Security Data SA + Hermes ECI.
 *
 * Bugs fixed:
 *  - Bug 1 (P0): signedAttrs DER was emitted with IMPLICIT [0] tag (0xa0)
 *    instead of EXPLICIT SET (0x31) required by RFC 5652 §5.4 for signature
 *    verification. Real ECI PDFs verified with sigValid=false → status='invalid'
 *    even though digestMatches=true and TSL roots were placeholders.
 *  - Bug 2 (P0): once sigValid is true, TSL placeholder branch correctly maps
 *    to status='warning' + TRUST_PLACEHOLDER + DEMO banner. Locked here as
 *    regression: real ECI PDF + placeholder roots ⇒ warning, never invalid.
 *  - Bug 3 (P1): subjectInfo().cn used `tv.value.toString()` which returns
 *    asn1js debug repr like `UTF8String : 'NAME'`. Now uses `.valueBlock.value`
 *    yielding the raw string content.
 */

import { describe, test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSignature } from '../src/pdf';
import { parseCms } from '../src/cms';
import { verifyPdf } from '../src/index';

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const REAL_PDFS: { file: string; expectedCn: string }[] = [
  { file: 'eci-real-signed.pdf', expectedCn: 'Alfonso Kuen Arroyo' },
  { file: 'eci-real-contrato2026.pdf', expectedCn: 'LUIS DANILO ORELLANA ARELLANO' },
  { file: 'eci-real-lideres.pdf', expectedCn: 'BEATRIZ DE LOURDES VALENCIA CACERES' },
];

describe('v0.3.3 regression — real ECI PDFs', () => {
  for (const { file, expectedCn } of REAL_PDFS) {
    test(`${file}: sigValid + warning status + clean signer CN + DEMO trigger`, async () => {
      const bytes = new Uint8Array(await readFile(resolve(FIX, file)));
      const r = await verifyPdf(bytes, { fetchOcsp: false });

      // Bug 2 fixed: status MUST be 'warning' (not 'invalid') for real ECI PDF
      // when all TSL roots are placeholders (current production state).
      expect(r.status).toBe('warning');

      // No engine error
      expect(r.error).toBeUndefined();

      // Document hash must match (sanity)
      expect(r.integrity?.digestMatches).toBe(true);

      // DEMO banner trigger: TRUST_PLACEHOLDER warning code MUST be present
      // (Verificar.svelte regex matches code OR /placeholder|provisional/ msg).
      const hasTrustPlaceholder = r.warnings.some((w) => w.code === 'TRUST_PLACEHOLDER');
      expect(hasTrustPlaceholder).toBe(true);

      // Bug 3 fixed: signer CN must be the raw string, not asn1js debug repr.
      expect(r.signer?.cert.subject.cn).toBe(expectedCn);
      expect(r.signer?.cert.subject.cn).not.toMatch(/^UTF8String\s*:/);
      expect(r.signer?.cert.subject.cn).not.toMatch(/^PrintableString\s*:/);
    }, 30000);
  }

  test('Bug 1: signedAttrsDer is encoded with EXPLICIT SET tag (0x31), not IMPLICIT [0] (0xa0)', async () => {
    // RFC 5652 §5.4 — the value over which the signature is computed must use
    // EXPLICIT SET tag. Real ECI PDFs sign exactly that. If we emit 0xa0 the
    // signature verifies false. This test locks the encoding.
    const bytes = new Uint8Array(await readFile(resolve(FIX, 'eci-real-signed.pdf')));
    const sig = await findSignature(bytes);
    expect(sig).not.toBeNull();
    const cms = await parseCms(sig!.contents);
    expect(cms.signedAttrsDer.length).toBeGreaterThan(0);
    expect(cms.signedAttrsDer[0]).toBe(0x31);
  });

  test('engine version reports 0.3.3', async () => {
    const bytes = new Uint8Array(await readFile(resolve(FIX, 'eci-real-signed.pdf')));
    const r = await verifyPdf(bytes, { fetchOcsp: false });
    expect(r.engineVersion).toBe('0.3.3');
  });
});
