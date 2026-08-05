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

  test('UANATACA CA2 2021 is bundled and chains to the "uanataca" root', async () => {
    const inters = await getIntermediates();
    const uana = inters.find((i) => i.slug === 'uanataca-ca2-2021');
    expect(
      uana,
      'UANATACA CA2 2021 must be bundled (2nd real-world leaf-only case, new subordinate)',
    ).toBeDefined();
    if (!uana) return;
    expect(uana.rootSlug).toBe('uanataca');
    expect(uana.commonName).toBe('UANATACA CA2 2021');
    expect(uana.fingerprintSha256).toBe(
      '15ceab339144d48d352eef1c227f4d2ef4fc1756dead602c22be32d52100e69a',
    );

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

  test('UANATACA 2016 and 2021 intermediates coexist (parallel issuing CAs, not a replacement)', async () => {
    const inters = await getIntermediates();
    const uana2016 = inters.find((i) => i.slug === 'uanataca-ca2-2016');
    const uana2021 = inters.find((i) => i.slug === 'uanataca-ca2-2021');
    expect(uana2016, 'the 2016 intermediate must still be present').toBeDefined();
    expect(uana2021, 'the 2021 intermediate must be present').toBeDefined();
    if (!uana2016 || !uana2021) return;
    expect(uana2016.fingerprintSha256).not.toBe(uana2021.fingerprintSha256);
  });

  // 2026-08-05 batch: 20 intermediates extracted from the MINTEL FirmaEC jar
  // (ec.gob.firmadigital.libreria), covering the remaining ACEs whose
  // subordinate CAs were previously missing from the trust store.
  const FIRMAEC_2026_08_05_SLUGS: Array<{ slug: string; rootSlug: string; commonName: string }> = [
    {
      slug: 'alpha-technologies-2023-subca',
      rootSlug: 'alpha-technologies-2023',
      commonName: 'Alpha Technologies Atlas Signing CA 2023',
    },
    {
      slug: 'alpha-technologies-subca',
      rootSlug: 'alpha-technologies',
      commonName: 'Alpha Technologies Atlas Signing CA 2024',
    },
    { slug: 'anfac-2016-subca', rootSlug: 'anfac-2016', commonName: 'ANF Ecuador CA1' },
    {
      slug: 'anfac-subca',
      rootSlug: 'anfac',
      commonName: 'ANF High Assurance Ecuador Intermediate CA',
    },
    {
      slug: 'appfirmas-2025-subca',
      rootSlug: 'appfirmas-2025',
      commonName: 'APPFIRMAS S.A. Sub CA',
    },
    { slug: 'appfirmas-subca', rootSlug: 'appfirmas', commonName: 'APPFIRMAS SUB C1' },
    { slug: 'argosdata-subca', rootSlug: 'argosdata', commonName: 'ArgosData CA 1 - SHA256' },
    { slug: 'argosdata-2026-subca', rootSlug: 'argosdata-2026', commonName: 'ArgosData Sub CA' },
    // 2026-08-05 HIGH fix: commonName corrected to match the certificate's
    // real subject CN (was '... (2011)', which never matched the PEM). It is
    // now IDENTICAL to bce-subca-2019's commonName — see the DN-collision
    // tests below for how the selectors disambiguate the two.
    { slug: 'bce-subca-2011', rootSlug: 'bce', commonName: 'AC BANCO CENTRAL DEL ECUADOR' },
    { slug: 'bce-subca-2019', rootSlug: 'bce', commonName: 'AC BANCO CENTRAL DEL ECUADOR' },
    { slug: 'darkcam-subca', rootSlug: 'darkcam', commonName: 'DARKCAM S.A. - CA Subordinada' },
    {
      slug: 'datil-subca-2021',
      rootSlug: 'datil',
      commonName: 'Datil Autoridad de Certificacion Subordinada',
    },
    {
      slug: 'datil-2025-subca',
      rootSlug: 'datil-2025',
      commonName: 'Datil Autoridad de Certificacion Subordinada 2',
    },
    {
      slug: 'datil-2025-subca-corta-duracion',
      rootSlug: 'datil-2025',
      commonName: 'Datil Autoridad de Certificacion Subordinada Corta Duracion',
    },
    {
      slug: 'firmasegura-subca',
      rootSlug: 'firmasegura',
      commonName: 'AUTORIDAD DE CERTIFICACION SUBCA-1 FIRMASEGURA S.A.S.',
    },
    { slug: 'lazzate-subca', rootSlug: 'lazzate', commonName: 'Lazzate Emisor CA' },
    { slug: 'letmi-subca', rootSlug: 'letmi', commonName: 'LETMI RSA SUB C1' },
    {
      slug: 'securitydata-legacy-subca-2011',
      rootSlug: 'securitydata-legacy',
      commonName: 'AUTORIDAD DE CERTIFICACION SUB SECURITY DATA',
    },
    {
      slug: 'securitydata-legacy-subca-2019',
      rootSlug: 'securitydata-legacy',
      commonName: 'AUTORIDAD DE CERTIFICACION SUBCA-1 SECURITY DATA',
    },
    { slug: 'uanataca-ca1-2016', rootSlug: 'uanataca', commonName: 'UANATACA CA1 2016' },
  ];

  test.each(FIRMAEC_2026_08_05_SLUGS)(
    '$slug is bundled, has the declared commonName, and chains to rootSlug "$rootSlug"',
    async ({ slug, rootSlug, commonName }) => {
      const inters = await getIntermediates();
      const entry = inters.find((i) => i.slug === slug);
      expect(entry, `${slug} must be bundled`).toBeDefined();
      if (!entry) return;
      expect(entry.rootSlug).toBe(rootSlug);
      expect(entry.commonName).toBe(commonName);

      const roots = await getTrustRoots();
      const root = roots.find((r) => r.slug === rootSlug);
      expect(root, `declared rootSlug "${rootSlug}" must exist in roots.ts`).toBeDefined();
      if (!root) return;

      const interCert = new X509Certificate(entry.pemContent);
      const rootCert = new X509Certificate(root.pemContent);
      expect(interCert.issuer, 'intermediate.issuer must equal root.subject').toBe(
        rootCert.subject,
      );
      expect(interCert.subject, 'intermediate must NOT be self-signed').not.toBe(interCert.issuer);
      expect(
        interCert.checkIssued(rootCert),
        'root must cryptographically be the issuer of the intermediate',
      ).toBe(true);
    },
  );

  test('all 20 intermediates from the 2026-08-05 FirmaEC jar batch are present and distinct', async () => {
    const inters = await getIntermediates();
    const slugs = FIRMAEC_2026_08_05_SLUGS.map((s) => s.slug);
    const found = slugs.filter((slug) => inters.some((i) => i.slug === slug));
    expect(found).toHaveLength(slugs.length);

    const fingerprints = new Set(inters.map((i) => i.fingerprintSha256));
    expect(fingerprints.size, 'no duplicate fingerprints across the whole bundle').toBe(
      inters.length,
    );
  });

  // 2026-08-05 HIGH fix: bce-subca-2011/2019 share the exact same subject DN
  // (confirmed with `openssl x509 -noout -subject` on both PEMs) — the two
  // selectors that used to pick a bundled intermediate by subject DN alone
  // (verifier's selectBridgingIntermediates, signer's
  // resolveSigningIntermediates) picked whichever was declared FIRST,
  // embedding/accepting the wrong subCA for real BCE leaves. The selectors
  // now disambiguate via AKI/SKI (see resolveIssuerCert in
  // @firma-ec/crypto-core, tested end-to-end in
  // packages/verifier/tests/resolve-issuer-cert.test.ts). This test guards
  // the DATA side of that fix: any subject-DN collision that shows up in
  // this file from here on must be an EXPLICITLY reviewed, intentional one
  // (added to KNOWN_SUBJECT_DN_COLLISIONS below) — an accidental new
  // collision must fail CI, not silently repeat this bug with a different
  // pair of slugs.
  const KNOWN_SUBJECT_DN_COLLISIONS: ReadonlySet<string> = new Set([
    ['bce-subca-2011', 'bce-subca-2019'].sort().join('|'),
  ]);

  test('no undocumented subject-DN collisions between bundled intermediates', async () => {
    const inters = await getIntermediates();
    const bySubject = new Map<string, string[]>();
    for (const it of inters) {
      const subject = new X509Certificate(it.pemContent).subject;
      const slugs = bySubject.get(subject) ?? [];
      slugs.push(it.slug);
      bySubject.set(subject, slugs);
    }

    for (const [subject, slugs] of bySubject) {
      if (slugs.length < 2) continue;
      for (let i = 0; i < slugs.length; i++) {
        for (let j = i + 1; j < slugs.length; j++) {
          const key = [slugs[i], slugs[j]].sort().join('|');
          expect(
            KNOWN_SUBJECT_DN_COLLISIONS.has(key),
            `undocumented subject-DN collision between "${slugs[i]}" and "${slugs[j]}" (subject: ${subject}) — either this is an accidental duplicate, or a real renewal that must be added to KNOWN_SUBJECT_DN_COLLISIONS and verified to resolve correctly via AKI/SKI (see resolve-issuer-cert.test.ts in @firma-ec/verifier)`,
          ).toBe(true);
        }
      }
    }

    // Sanity: the known collision must still exist and involve distinct certs
    // (guards against someone "fixing" it by silently deleting one entry).
    const bce2011 = inters.find((i) => i.slug === 'bce-subca-2011');
    const bce2019 = inters.find((i) => i.slug === 'bce-subca-2019');
    expect(
      bce2011,
      'bce-subca-2011 must still be bundled (LTV/historical verification)',
    ).toBeDefined();
    expect(bce2019, 'bce-subca-2019 must still be bundled').toBeDefined();
    if (bce2011 && bce2019) {
      expect(bce2011.fingerprintSha256).not.toBe(bce2019.fingerprintSha256);
    }
  });

  test('digercic/Registro Civil intermediate was NOT integrated (root is isDefunct/isPlaceholder)', async () => {
    const inters = await getIntermediates();
    const digercic = inters.find((i) => i.slug.includes('digercic'));
    expect(
      digercic,
      'digercic must stay unintegrated pending human review of the isDefunct note in roots.ts',
    ).toBeUndefined();
  });
});
