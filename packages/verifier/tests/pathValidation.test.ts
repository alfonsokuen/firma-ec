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

  test('all-placeholders TSL: returns success:false with placeholder warnings', async () => {
    // Verify the current TSL state: all 7 roots are placeholders
    const roots = await getTrustRoots();
    expect(roots.every((r) => r.isPlaceholder)).toBe(true);

    // validatePath with placeholder-only roots should return success:false
    // with warnings describing each skipped placeholder root.
    // We use a dummy Certificate — parseCms will not be reached since
    // trustedCerts will be empty after skipping all placeholders.
    // Import Certificate lazily to avoid pkijs setup burden in this test.
    const { Certificate } = await import('pkijs');
    const fakeCert = new Certificate();
    const result = await validatePath(fakeCert, [], roots, new Date());

    expect(result.success).toBe(false);
    // All 7 placeholder roots should be reported in warnings
    expect(result.warnings.length).toBeGreaterThanOrEqual(roots.length);
    expect(result.warnings.every((w) => w.includes('placeholder'))).toBe(true);
    // Error message should describe the all-placeholder situation
    expect(result.error).toMatch(/placeholder/i);
  });
});
