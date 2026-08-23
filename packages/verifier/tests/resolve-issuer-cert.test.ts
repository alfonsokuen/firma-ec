/**
 * resolve-issuer-cert.test.ts — 2026-08-05 HIGH fix (BCE subCA subject-DN
 * collision, reproduced by an independent code-reviewer).
 *
 * `bce-subca-2011` (expired) and `bce-subca-2019` (live) in
 * `packages/tsl-ec/src/intermediates.ts` share the EXACT same subject DN
 * (`CN=AC BANCO CENTRAL DEL ECUADOR`) — confirmed with
 * `openssl x509 -noout -subject` on both PEMs. The two selectors that used to
 * pick a bundled intermediate by subject DN (`selectBridgingIntermediates` in
 * `packages/verifier/src/index.ts`, `resolveSigningIntermediates` in
 * `packages/signer/src/chainIntermediates.ts`) both used a plain
 * `Array.find()`, which returns whichever entry is declared FIRST regardless
 * of which one actually issued the certificate in hand. Because the expired
 * 2011 subCA is declared before the live 2019 one, a real BCE leaf (issued by
 * 2019) resolved to the WRONG intermediate — reproduced in both directions
 * (wrong intermediate embedded when signing, real chain rejected when
 * verifying).
 *
 * `resolveIssuerCert` (packages/crypto-core/src/x509.ts) is the shared fix:
 * match by Authority Key Identifier (child) == Subject Key Identifier
 * (candidate) first, falling back to real cryptographic verification
 * (`Certificate.verify()`) only when AKI/SKI can't disambiguate. These tests
 * exercise it directly with a synthetic stand-in for the BCE shape — two
 * subordinate CAs sharing one subject DN, different keys — asserting the
 * resolution is correct and INDEPENDENT of array declaration order.
 */

import { resolveIssuerCert } from '@firma-ec/crypto-core';
import { fromBER } from 'asn1js';
import forge from 'node-forge';
import { Certificate } from 'pkijs';
import { describe, expect, test } from 'vitest';

const YEAR = 365 * 24 * 60 * 60 * 1000;

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
  /** Force the same subject DN as another cert (BCE-style renewal collision). */
  subjectOverride?: forge.pki.CertificateField[];
}): Gen {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = opts.serial;
  cert.validity.notBefore = opts.notBefore;
  cert.validity.notAfter = opts.notAfter;
  const subjectAttrs: forge.pki.CertificateField[] = opts.subjectOverride ?? [
    { name: 'commonName', value: opts.cn },
  ];
  cert.setSubject(subjectAttrs);
  cert.setIssuer(opts.issuer ? opts.issuer.cert.subject.attributes : subjectAttrs);
  const extensions: forge.pki.CertificateFieldExtension[] = [
    { name: 'basicConstraints', cA: opts.isCa },
    opts.isCa
      ? { name: 'keyUsage', keyCertSign: true, cRLSign: true }
      : { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    { name: 'subjectKeyIdentifier' },
  ];
  if (opts.issuer) {
    extensions.push({ name: 'authorityKeyIdentifier', keyIdentifier: true });
  }
  cert.setExtensions(extensions);
  cert.sign(opts.issuer ? opts.issuer.keys.privateKey : keys.privateKey, forge.md.sha256.create());
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return { der: Uint8Array.from(der, (c) => c.charCodeAt(0)), keys, cert };
}

function pkijsCert(der: Uint8Array): Certificate {
  const asn = fromBER(
    der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer,
  );
  if (asn.offset === -1) throw new Error('DER decode failed');
  return new Certificate({ schema: asn.result });
}

describe('resolveIssuerCert — BCE-style subject-DN collision between two subordinate CAs', () => {
  test('resolves to the subCA that actually issued the leaf, in both array orders', async () => {
    const now = new Date('2026-08-05T00:00:00Z');
    const root = makeCert({
      cn: 'Synthetic BCE Root',
      notBefore: new Date(now.getTime() - 5 * YEAR),
      notAfter: new Date(now.getTime() + 10 * YEAR),
      isCa: true,
      serial: '01',
    });
    const sharedSubject: forge.pki.CertificateField[] = [
      { name: 'commonName', value: 'AC BANCO CENTRAL DEL ECUADOR' },
    ];
    // "2011" subCA — expired, same subject DN, DIFFERENT key than the 2019 one.
    const subCa2011 = makeCert({
      cn: 'AC BANCO CENTRAL DEL ECUADOR',
      notBefore: new Date(now.getTime() - 15 * YEAR),
      notAfter: new Date(now.getTime() - 5 * YEAR), // expired
      isCa: true,
      serial: '02',
      issuer: root,
      subjectOverride: sharedSubject,
    });
    // "2019" subCA — live, SAME subject DN, different key.
    const subCa2019 = makeCert({
      cn: 'AC BANCO CENTRAL DEL ECUADOR',
      notBefore: new Date(now.getTime() - 7 * YEAR),
      notAfter: new Date(now.getTime() + 3 * YEAR),
      isCa: true,
      serial: '03',
      issuer: root,
      subjectOverride: sharedSubject,
    });
    // Real leaf issued by the LIVE 2019 subCA.
    const leaf = makeCert({
      cn: 'BCE FUNCIONARIO TEST',
      notBefore: new Date(now.getTime() - 1 * YEAR),
      notAfter: new Date(now.getTime() + 1 * YEAR),
      isCa: false,
      serial: '04',
      issuer: subCa2019,
    });

    expect(
      subCa2011.cert.subject.getField('CN')?.value,
      'sanity: both subCAs must share the exact subject CN to reproduce the collision',
    ).toBe(subCa2019.cert.subject.getField('CN')?.value);

    const leafPki = pkijsCert(leaf.der);
    const cand2011 = pkijsCert(subCa2011.der);
    const cand2019 = pkijsCert(subCa2019.der);

    // Order A: expired-first (the exact shape of the real bug — bce-subca-2011
    // is declared before bce-subca-2019 in intermediates.ts).
    const resolvedA = await resolveIssuerCert(leafPki, [cand2011, cand2019]);
    expect(
      resolvedA?.serialNumber.valueBlock.toString(),
      'must resolve to the subCA that actually issued the leaf (2019), not whichever is declared first',
    ).toBe(cand2019.serialNumber.valueBlock.toString());

    // Order B: reversed — resolution must NOT depend on array order at all.
    const resolvedB = await resolveIssuerCert(leafPki, [cand2019, cand2011]);
    expect(resolvedB?.serialNumber.valueBlock.toString()).toBe(
      cand2019.serialNumber.valueBlock.toString(),
    );
  });

  test('falls back to real cryptographic verification when AKI/SKI cannot disambiguate', async () => {
    const now = new Date('2026-08-05T00:00:00Z');
    const root = makeCert({
      cn: 'Synthetic Root No KeyIds',
      notBefore: new Date(now.getTime() - 5 * YEAR),
      notAfter: new Date(now.getTime() + 10 * YEAR),
      isCa: true,
      serial: '01',
    });
    const sharedSubject: forge.pki.CertificateField[] = [
      { name: 'commonName', value: 'Shared Subject No KeyIds' },
    ];

    // Build two candidates WITHOUT subjectKeyIdentifier so the AKI/SKI path
    // can't disambiguate — forces the cryptographic-verification fallback.
    function makeCertNoSki(serial: string): Gen {
      const keys = forge.pki.rsa.generateKeyPair(2048);
      const cert = forge.pki.createCertificate();
      cert.publicKey = keys.publicKey;
      cert.serialNumber = serial;
      cert.validity.notBefore = new Date(now.getTime() - 5 * YEAR);
      cert.validity.notAfter = new Date(now.getTime() + 5 * YEAR);
      cert.setSubject(sharedSubject);
      cert.setIssuer(root.cert.subject.attributes);
      cert.setExtensions([
        { name: 'basicConstraints', cA: true },
        { name: 'keyUsage', keyCertSign: true, cRLSign: true },
      ]);
      cert.sign(root.keys.privateKey, forge.md.sha256.create());
      const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
      return { der: Uint8Array.from(der, (c) => c.charCodeAt(0)), keys, cert };
    }

    const decoy = makeCertNoSki('05'); // same DN, valid CA, but did NOT issue the leaf
    const real = makeCertNoSki('06'); // same DN, valid CA, DID issue the leaf

    const leaf = makeCert({
      cn: 'Leaf No KeyIds',
      notBefore: new Date(now.getTime() - 1 * YEAR),
      notAfter: new Date(now.getTime() + 1 * YEAR),
      isCa: false,
      serial: '07',
      issuer: real,
    });

    const leafPki = pkijsCert(leaf.der);
    const decoyPki = pkijsCert(decoy.der);
    const realPki = pkijsCert(real.der);

    const resolved = await resolveIssuerCert(leafPki, [decoyPki, realPki]);
    expect(
      resolved?.serialNumber.valueBlock.toString(),
      'without AKI/SKI, must fall back to real signature verification and pick the true issuer',
    ).toBe(realPki.serialNumber.valueBlock.toString());
  });
});

describe('resolveIssuerCert — renovación de CA que CONSERVA la clave (tie-break por vigencia)', () => {
  /** CA con clave IMPUESTA: la renovación real que conserva el par de claves
   *  produce dos certs con el MISMO SKI y cuya firma sobre el hijo verifica
   *  con AMBOS — ni AKI/SKI ni la verificación criptográfica desambiguan.
   *  El único discriminante que queda es la vigencia. */
  function makeCaWithKeys(opts: {
    keys: forge.pki.rsa.KeyPair;
    subject: forge.pki.CertificateField[];
    notBefore: Date;
    notAfter: Date;
    serial: string;
    issuer: Gen;
  }): Gen {
    const cert = forge.pki.createCertificate();
    cert.publicKey = opts.keys.publicKey;
    cert.serialNumber = opts.serial;
    cert.validity.notBefore = opts.notBefore;
    cert.validity.notAfter = opts.notAfter;
    cert.setSubject(opts.subject);
    cert.setIssuer(opts.issuer.cert.subject.attributes);
    cert.setExtensions([
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true },
      { name: 'subjectKeyIdentifier' },
      { name: 'authorityKeyIdentifier', keyIdentifier: true },
    ]);
    cert.sign(opts.issuer.keys.privateKey, forge.md.sha256.create());
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    return { der: Uint8Array.from(der, (c) => c.charCodeAt(0)), keys: opts.keys, cert };
  }

  test('prefiere la renovación VIGENTE cuando ambas comparten clave y ambas verifican', async () => {
    const now = new Date();
    const root = makeCert({
      cn: 'Synthetic Root SameKey',
      notBefore: new Date(now.getTime() - 12 * YEAR),
      notAfter: new Date(now.getTime() + 10 * YEAR),
      isCa: true,
      serial: '01',
    });
    const sharedKeys = forge.pki.rsa.generateKeyPair(2048);
    const sharedSubject: forge.pki.CertificateField[] = [
      { name: 'commonName', value: 'AC RENOVADA MISMA CLAVE' },
    ];
    const caExpired = makeCaWithKeys({
      keys: sharedKeys,
      subject: sharedSubject,
      notBefore: new Date(now.getTime() - 10 * YEAR),
      notAfter: new Date(now.getTime() - 1 * YEAR), // caducada
      serial: '02',
      issuer: root,
    });
    const caLive = makeCaWithKeys({
      keys: sharedKeys,
      subject: sharedSubject,
      notBefore: new Date(now.getTime() - 1 * YEAR),
      notAfter: new Date(now.getTime() + 6 * YEAR), // vigente
      serial: '03',
      issuer: root,
    });
    // Hoja firmada con la CLAVE compartida — su firma verifica contra AMBOS certs.
    const leaf = makeCert({
      cn: 'FUNCIONARIO MISMA CLAVE',
      notBefore: new Date(now.getTime() - 0.5 * YEAR),
      notAfter: new Date(now.getTime() + 1 * YEAR),
      isCa: false,
      serial: '04',
      issuer: caLive,
    });

    const leafPki = pkijsCert(leaf.der);
    const candExpired = pkijsCert(caExpired.der);
    const candLive = pkijsCert(caLive.der);

    // Sanity: la firma de la hoja verifica contra los DOS candidatos (misma
    // clave) — sin esto el test no ejercita la ambigüedad que dice probar.
    expect(await leafPki.verify(candExpired)).toBe(true);
    expect(await leafPki.verify(candLive)).toBe(true);

    // Orden adverso: la caducada declarada primero.
    const resolvedA = await resolveIssuerCert(leafPki, [candExpired, candLive]);
    expect(
      resolvedA?.serialNumber.valueBlock.toString(),
      'con ambas verificando, debe preferir la renovación VIGENTE, no la primera declarada',
    ).toBe(candLive.serialNumber.valueBlock.toString());

    // Orden favorable: mismo resultado (independencia del orden).
    const resolvedB = await resolveIssuerCert(leafPki, [candLive, candExpired]);
    expect(resolvedB?.serialNumber.valueBlock.toString()).toBe(
      candLive.serialNumber.valueBlock.toString(),
    );
  });
});
