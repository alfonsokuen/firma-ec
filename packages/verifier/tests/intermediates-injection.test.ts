import { digest, toHex } from '@firma-ec/crypto-core';
import type { TrustIntermediate, TrustRoot } from '@firma-ec/tsl-ec';
import forge from 'node-forge';
import { describe, expect, test } from 'vitest';
import { checkCertificate } from '../src/certCheck';

/**
 * intermediates-injection.test.ts — bundled subordinate-CA completion.
 *
 * Reproduces the real UANATACA failure (2026-05-28): a leaf issued by a
 * subordinate CA, packaged in a .p12 that ships ONLY the leaf, signed an
 * e-invoice. firmar.ec rejected it ("el emisor no está reconocido en Ecuador")
 * because the offline verifier could not bridge leaf → intermediate → root.
 *
 * These tests use a synthetic 3-level PKI (root → intermediate → leaf). The
 * leaf is validated with NO intermediate supplied by the caller (mirroring a
 * leaf-only .p12). The chain must:
 *   - FAIL when no bundled intermediate is available (the bug), and
 *   - SUCCEED when the intermediate is supplied via the bundle (the fix),
 * proving the bundled intermediate — not a relaxed trust check — is what closes
 * the gap. A bundled intermediate must NEVER make an UNtrusted root pass.
 */

interface Gen {
  der: Uint8Array;
  keys: forge.pki.rsa.KeyPair;
  cert: forge.pki.Certificate;
}

function makeCert(opts: {
  cn: string;
  notBefore: Date;
  notAfter: Date;
  isCa: boolean;
  serial: string;
  issuer?: Gen;
}): Gen {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = opts.serial;
  cert.validity.notBefore = opts.notBefore;
  cert.validity.notAfter = opts.notAfter;
  const subjectAttrs: forge.pki.CertificateField[] = [{ name: 'commonName', value: opts.cn }];
  cert.setSubject(subjectAttrs);
  cert.setIssuer(opts.issuer ? opts.issuer.cert.subject.attributes : subjectAttrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: opts.isCa },
    opts.isCa
      ? { name: 'keyUsage', keyCertSign: true, cRLSign: true }
      : { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
  ]);
  cert.sign(opts.issuer ? opts.issuer.keys.privateKey : keys.privateKey, forge.md.sha256.create());
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return { der: Uint8Array.from(der, (c) => c.charCodeAt(0)), keys, cert };
}

async function asRoot(slug: string, gen: Gen): Promise<TrustRoot> {
  return {
    slug,
    commonName: gen.cert.subject.getField('CN')?.value ?? slug,
    orgName: `${slug} Org S.A.`,
    country: 'EC',
    pemContent: forge.pki.certificateToPem(gen.cert),
    fingerprintSha256: toHex(await digest('SHA-256', gen.der)),
    validFrom: gen.cert.validity.notBefore.toISOString(),
    validUntil: gen.cert.validity.notAfter.toISOString(),
    isPlaceholder: false,
  };
}

async function asIntermediate(
  slug: string,
  rootSlug: string,
  gen: Gen,
): Promise<TrustIntermediate> {
  return {
    slug,
    commonName: gen.cert.subject.getField('CN')?.value ?? slug,
    rootSlug,
    orgName: `${slug} Org S.A.`,
    pemContent: forge.pki.certificateToPem(gen.cert),
    fingerprintSha256: toHex(await digest('SHA-256', gen.der)),
    validFrom: gen.cert.validity.notBefore.toISOString(),
    validUntil: gen.cert.validity.notAfter.toISOString(),
  };
}

const YEAR = 365 * 24 * 60 * 60 * 1000;

function buildPki(now: Date) {
  const root = makeCert({
    cn: 'Synthetic ACE Root 2016',
    notBefore: new Date(now.getTime() - 2 * YEAR),
    notAfter: new Date(now.getTime() + 10 * YEAR),
    isCa: true,
    serial: '01',
  });
  const inter = makeCert({
    cn: 'Synthetic ACE CA2 2016',
    notBefore: new Date(now.getTime() - 2 * YEAR),
    notAfter: new Date(now.getTime() + 8 * YEAR),
    isCa: true,
    serial: '02',
    issuer: root,
  });
  const leaf = makeCert({
    cn: 'JUANA PEREZ',
    notBefore: new Date(now.getTime() - 1 * YEAR),
    notAfter: new Date(now.getTime() + 1 * YEAR),
    isCa: false,
    serial: '0a1b',
    issuer: inter,
  });
  return { root, inter, leaf };
}

describe('checkCertificate — bundled intermediate completion', () => {
  test('leaf-only (.p12 sin intermedia) FALLA sin intermedia bundled — reproduce el bug', async () => {
    const now = new Date('2026-05-28T00:00:00Z');
    const { root, leaf } = buildPki(now);
    const rootFx = await asRoot('synth-ace', root);

    // No intermediate from the caller AND none from the bundle.
    const r = await checkCertificate(leaf.der, [], {
      trustRoots: [rootFx],
      trustIntermediates: [],
      atTime: now,
    });

    expect(r.validityStatus).toBe('valid');
    expect(r.trusted, 'sin intermedia el chain no se puede armar → no confiable').toBe(false);
    expect(r.matchedAceSlug).toBeUndefined();
  });

  test('leaf-only VALIDA cuando la intermedia viene del bundle — el fix', async () => {
    const now = new Date('2026-05-28T00:00:00Z');
    const { root, inter, leaf } = buildPki(now);
    const rootFx = await asRoot('synth-ace', root);
    const interFx = await asIntermediate('synth-ace-ca2', 'synth-ace', inter);

    const r = await checkCertificate(leaf.der, [], {
      trustRoots: [rootFx],
      trustIntermediates: [interFx],
      atTime: now,
    });

    expect(r.validityStatus).toBe('valid');
    expect(r.trusted, 'con la intermedia bundled el chain llega a la raíz confiada').toBe(true);
    expect(r.matchedAceSlug).toBe('synth-ace');
  });

  test('una intermedia bundled NO puede hacer confiable una raíz NO confiada', async () => {
    const now = new Date('2026-05-28T00:00:00Z');
    const { inter, leaf } = buildPki(now);
    // The intermediate is bundled, but the root is NOT in trustRoots.
    const interFx = await asIntermediate('synth-ace-ca2', 'synth-ace', inter);
    // An unrelated trusted root that did not issue our intermediate.
    const unrelated = makeCert({
      cn: 'Unrelated Root',
      notBefore: new Date(now.getTime() - 2 * YEAR),
      notAfter: new Date(now.getTime() + 10 * YEAR),
      isCa: true,
      serial: 'ff',
    });
    const unrelatedFx = await asRoot('unrelated', unrelated);

    const r = await checkCertificate(leaf.der, [], {
      trustRoots: [unrelatedFx],
      trustIntermediates: [interFx],
      atTime: now,
    });

    expect(
      r.trusted,
      'sin la raíz emisora en el trust store, la intermedia no otorga confianza',
    ).toBe(false);
  });
});
