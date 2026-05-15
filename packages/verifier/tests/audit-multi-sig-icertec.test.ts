import { describe, test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyAllSignatures } from '../src/index';

const FIX = resolve(__dirname, 'fixtures');

/**
 * Audit regression 2026-05-15: PDF 075-2026.pdf (Consejo de la Judicatura, 4
 * iCert-EC firmas). Signer #1 (MAGALY RUIZ CAJAS) omitió la cadena en su CMS
 * — solo embebió el leaf. Las firmas #2/#3/#4 sí traen el intermediate +
 * root iCert-EC. Pre-fix, firmar.ec marcaba #1 'invalid' por chain failure
 * mientras que el desktop FirmaEC y otros verifiers la aceptaban (usan cache
 * de intermediates).
 *
 * Fix (v0.7.16): verifyAllSignatures harvests intermediates from EVERY sig
 * CMS in the same PDF y los comparte al validar cada firma individualmente.
 */
describe('multi-sig intermediate pooling (audit 075-2026)', () => {
  test('all 4 iCert-EC signatures resolve chain (matchedRootSlug=judicatura)', async () => {
    const bytes = new Uint8Array(await readFile(resolve(FIX, 'audit-075-2026.pdf')));
    const r = await verifyAllSignatures(bytes, { fetchOcsp: false });
    expect(r.signatureCount).toBe(4);
    for (const [i, sig] of r.signatures.entries()) {
      expect(sig.status, `sig #${i + 1}`).not.toBe('invalid');
      expect(sig.signer?.matchedRootSlug, `sig #${i + 1}`).toBe('judicatura');
    }
  }, 30000);
});
