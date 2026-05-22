import { digest, toHex } from '@firma-ec/crypto-core';
import type { TrustRoot } from '@firma-ec/tsl-ec';
import forge from 'node-forge';
import { describe, expect, test } from 'vitest';
import { checkCertificate } from '../src/certCheck';

/**
 * certCheck.test.ts — deterministic, network-free tests for `checkCertificate`.
 *
 * Certificates are generated in-memory with node-forge (a devDependency, same
 * as the other verifier tests). Trust roots are supplied via `opts.trustRoots`
 * and `atTime` is always passed explicitly so the tests never touch the network
 * (no `getTrustRoots()`) and never depend on the wall clock.
 */

interface GeneratedCert {
  der: Uint8Array;
  /** node-forge keypair, exposed so a CA can sign a child cert. */
  keys: forge.pki.rsa.KeyPair;
  cert: forge.pki.Certificate;
}

/**
 * Build an X.509 certificate. When `issuer` is omitted the cert is self-signed
 * (a CA root); otherwise it is signed by the issuer's private key.
 */
function makeCert(opts: {
  cn: string;
  notBefore: Date;
  notAfter: Date;
  isCa: boolean;
  serial: string;
  issuer?: GeneratedCert;
}): GeneratedCert {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = opts.serial;
  cert.validity.notBefore = opts.notBefore;
  cert.validity.notAfter = opts.notAfter;

  const subjectAttrs = [{ name: 'commonName', value: opts.cn }];
  cert.setSubject(subjectAttrs);
  cert.setIssuer(opts.issuer ? opts.issuer.cert.subject.attributes : subjectAttrs);

  cert.setExtensions([
    { name: 'basicConstraints', cA: opts.isCa },
    opts.isCa
      ? { name: 'keyUsage', keyCertSign: true, cRLSign: true }
      : { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
  ]);

  // Sign with the issuer's key (chain) or our own key (self-signed root).
  const signingKey = opts.issuer ? opts.issuer.keys.privateKey : keys.privateKey;
  cert.sign(signingKey, forge.md.sha256.create());

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const u8 = Uint8Array.from(der, (c) => c.charCodeAt(0));
  return { der: u8, keys, cert };
}

/** Wrap a generated CA cert as a real (non-placeholder) TrustRoot fixture. */
async function asTrustRoot(slug: string, gen: GeneratedCert): Promise<TrustRoot> {
  const pem = forge.pki.certificateToPem(gen.cert);
  const fingerprint = toHex(await digest('SHA-256', gen.der));
  return {
    slug,
    commonName: gen.cert.subject.getField('CN')?.value ?? slug,
    orgName: `${slug} Org S.A.`,
    country: 'EC',
    pemContent: pem,
    fingerprintSha256: fingerprint,
    validFrom: gen.cert.validity.notBefore.toISOString(),
    validUntil: gen.cert.validity.notAfter.toISOString(),
    isPlaceholder: false,
  };
}

const YEAR = 365 * 24 * 60 * 60 * 1000;

describe('checkCertificate', () => {
  test('expired self-signed cert → validityStatus "expired"', async () => {
    const now = new Date('2026-05-22T00:00:00Z');
    const leaf = makeCert({
      cn: 'Test Expired Holder',
      notBefore: new Date(now.getTime() - 3 * YEAR),
      notAfter: new Date(now.getTime() - 1 * YEAR), // expired 1 year ago
      isCa: false,
      serial: '01',
    });

    const r = await checkCertificate(leaf.der, [], { trustRoots: [], atTime: now });

    expect(r.validityStatus).toBe('expired');
    expect(r.subjectCN).toBe('Test Expired Holder');
    expect(r.trusted).toBe(false);
  });

  test('cert chaining to a provided real root → trusted + matchedAceSlug', async () => {
    const now = new Date('2026-05-22T00:00:00Z');
    const root = makeCert({
      cn: 'Acme ARCOTEL Root CA',
      notBefore: new Date(now.getTime() - 1 * YEAR),
      notAfter: new Date(now.getTime() + 5 * YEAR),
      isCa: true,
      serial: '10',
    });
    const leaf = makeCert({
      cn: 'Trusted Signer',
      notBefore: new Date(now.getTime() - 1 * YEAR),
      notAfter: new Date(now.getTime() + 1 * YEAR),
      isCa: false,
      serial: '11',
      issuer: root,
    });
    const rootFixture = await asTrustRoot('acme-ace', root);

    const r = await checkCertificate(leaf.der, [], {
      trustRoots: [rootFixture],
      atTime: now,
    });

    expect(r.validityStatus).toBe('valid');
    expect(r.trusted).toBe(true);
    expect(r.matchedAceSlug).toBe('acme-ace');
    expect(r.matchedAceOrg).toBe('acme-ace Org S.A.');
    expect(r.subjectCN).toBe('Trusted Signer');
    expect(r.issuerCN).toBe('Acme ARCOTEL Root CA');
  });

  test('cert not chaining to any provided root → trusted false', async () => {
    const now = new Date('2026-05-22T00:00:00Z');
    // A real but UNRELATED root: the leaf is signed by a different CA.
    const unrelatedRoot = makeCert({
      cn: 'Other Root CA',
      notBefore: new Date(now.getTime() - 1 * YEAR),
      notAfter: new Date(now.getTime() + 5 * YEAR),
      isCa: true,
      serial: '20',
    });
    const ownCa = makeCert({
      cn: 'Unlisted CA',
      notBefore: new Date(now.getTime() - 1 * YEAR),
      notAfter: new Date(now.getTime() + 5 * YEAR),
      isCa: true,
      serial: '21',
    });
    const leaf = makeCert({
      cn: 'Untrusted Signer',
      notBefore: new Date(now.getTime() - 1 * YEAR),
      notAfter: new Date(now.getTime() + 1 * YEAR),
      isCa: false,
      serial: '22',
      issuer: ownCa,
    });
    const rootFixture = await asTrustRoot('other-ace', unrelatedRoot);

    const r = await checkCertificate(leaf.der, [ownCa.der], {
      trustRoots: [rootFixture],
      atTime: now,
    });

    expect(r.validityStatus).toBe('valid');
    expect(r.trusted).toBe(false);
    expect(r.matchedAceSlug).toBeUndefined();
  });
});
