import { describe, test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { findSignature } from '../src/pdf';
import { parseCms } from '../src/cms';
import { validatePath } from '../src/pathValidation';
import { getTrustRoots } from '@firma-ec/tsl-ec';

describe('validatePath', () => {
  // TODO Task 11 — fixture not yet generated
  test.skip('builds chain to ARCOTEL root for a real signed PDF', async () => {
    const roots = await getTrustRoots();
    const signed = await readFile('tests/fixtures/security-data-pades-bb.pdf');
    const sig = await findSignature(new Uint8Array(signed));
    const cms = await parseCms(sig!.contents);
    const result = await validatePath(cms.signerCert, cms.intermediates, roots, cms.signingTime ?? new Date());

    expect(result.success).toBe(true);
    expect(result.matchedRoot?.slug).toBe('security-data');
    expect(result.chain.length).toBeGreaterThanOrEqual(2);
  });

  // TODO Task 11 — fixture not yet generated
  test.skip('fails for a non-EC certificate', async () => {
    const roots = await getTrustRoots();
    const signed = await readFile('tests/fixtures/foreign-pades.pdf');
    const sig = await findSignature(new Uint8Array(signed));
    const cms = await parseCms(sig!.contents);
    const result = await validatePath(cms.signerCert, cms.intermediates, roots, cms.signingTime ?? new Date());

    expect(result.success).toBe(false);
    expect(result.matchedRoot).toBeUndefined();
  });

  test('partial-placeholders TSL: returns success:false against synthetic empty signer; placeholder roots are skipped silently', async () => {
    // v0.7.13 (2026-05-15): placeholder roots are skipped without emitting
    // per-root warnings (UX cleanup — 8/8 active CAs now have real roots).
    const roots = await getTrustRoots();
    expect(roots.some((r) => r.isPlaceholder)).toBe(true);

    const { Certificate } = await import('pkijs');
    const fakeCert = new Certificate();
    const result = await validatePath(fakeCert, [], roots, new Date());

    expect(result.success).toBe(false);
    expect(result.warnings.filter((w) => w.includes('placeholder'))).toHaveLength(0);
  });
});
