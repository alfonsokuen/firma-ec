import { X509Certificate, createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { getIntermediates, getTrustRoots } from '../src/index.ts';

/**
 * intermediates.test.ts — the bundled subordinate CAs must be real, intact, and
 * actually chain to a trusted root in roots.ts (otherwise they're dead weight
 * that can't complete any path). Uses node:crypto only (tsl-ec has no asn1js).
 */

function fingerprint(pem: string): string {
  const x = new X509Certificate(pem);
  return createHash('sha256').update(x.raw).digest('hex');
}

describe('bundled intermediates', () => {
  test('every intermediate PEM decodes and matches its declared fingerprint', async () => {
    const inters = await getIntermediates();
    expect(inters.length).toBeGreaterThan(0);
    for (const it of inters) {
      expect(fingerprint(it.pemContent), `fingerprint mismatch for ${it.slug}`).toBe(
        it.fingerprintSha256,
      );
    }
  });

  test('every bundled intermediate cryptographically chains to its declared root', async () => {
    const inters = await getIntermediates();
    const roots = await getTrustRoots();
    for (const it of inters) {
      const root = roots.find((r) => r.slug === it.rootSlug);
      expect(root, `rootSlug "${it.rootSlug}" of ${it.slug} must exist in roots.ts`).toBeDefined();
      if (!root) continue;
      const interCert = new X509Certificate(it.pemContent);
      const rootCert = new X509Certificate(root.pemContent);
      expect(interCert.subject, `${it.slug} must not be self-signed`).not.toBe(interCert.issuer);
      expect(
        interCert.checkIssued(rootCert),
        `${it.slug} must be issued by root ${it.rootSlug}`,
      ).toBe(true);
    }
  });

  test('UANATACA CA2 2016 is bundled and chains to the "uanataca" root', async () => {
    const inters = await getIntermediates();
    const uana = inters.find((i) => i.slug === 'uanataca-ca2-2016');
    expect(uana, 'UANATACA CA2 2016 must be bundled (real-world leaf-only case)').toBeDefined();
    if (!uana) return;
    expect(uana.rootSlug).toBe('uanataca');
    expect(uana.commonName).toBe('UANATACA CA2 2016');

    const roots = await getTrustRoots();
    const root = roots.find((r) => r.slug === uana.rootSlug);
    expect(root, 'declared rootSlug must exist in roots.ts').toBeDefined();
    if (!root) return;

    const interCert = new X509Certificate(uana.pemContent);
    const rootCert = new X509Certificate(root.pemContent);

    // The intermediate must be signed by the root, and must not be self-signed.
    expect(interCert.issuer, 'intermediate.issuer must equal root.subject').toBe(rootCert.subject);
    expect(interCert.subject, 'intermediate must NOT be self-signed').not.toBe(interCert.issuer);
    expect(
      interCert.checkIssued(rootCert),
      'root must cryptographically be the issuer of the intermediate',
    ).toBe(true);
  });
});
