/**
 * chain-intermediates.test.ts — leaf-only .p12 round-trip (sign ↔ verify).
 *
 * Reproduces and locks the fix for the 2026-05-28 UANATACA incident: a cert
 * issued by a subordinate CA, packaged in a .p12 that ships ONLY the leaf,
 * produced a PDF whose CMS embedded only the leaf — and firmar.ec rejected its
 * own output ("el emisor no está reconocido en Ecuador") because the offline
 * verifier could not bridge leaf → intermediate → root.
 *
 * Synthetic 3-level PKI (root → intermediate → leaf), leaf-only .p12. We assert:
 *   1. unit: resolveSigningIntermediates appends the bundled intermediate.
 *   2. verifier-side fix: leaf-only PDF is INVALID with no intermediate, but
 *      VALID once the verifier's bundle supplies the intermediate.
 *   3. signer-side fix: signing with the bundle embeds the intermediate, so the
 *      PDF is self-contained and verifies VALID even with an empty verifier
 *      bundle (the Adobe / third-party-validator case).
 */

import { webcrypto } from 'node:crypto';
import type { TrustIntermediate, TrustRoot } from '@firma-ec/tsl-ec';
import forge from 'node-forge';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pkijs from 'pkijs';
import { beforeAll, describe, expect, it } from 'vitest';

import { verifyPdf } from '../../verifier/src/index.js';
import { resolveSigningIntermediates } from '../src/chainIntermediates.js';
import { parsePfx } from '../src/p12.js';
import { signPdfPades } from '../src/pades.js';

beforeAll(() => {
  pkijs.setEngine(
    'node-webcrypto',
    new pkijs.CryptoEngine({ name: 'node-webcrypto', crypto: webcrypto as unknown as Crypto }),
  );
  if (!(globalThis as { crypto?: Crypto }).crypto) {
    (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
  }
});

const PIN = 'test1234';
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
}): Gen {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = opts.serial;
  cert.validity.notBefore = opts.notBefore;
  cert.validity.notAfter = opts.notAfter;
  const attrs = [
    { name: 'commonName', value: opts.cn },
    { name: 'countryName', value: 'EC' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(opts.issuer ? opts.issuer.cert.subject.attributes : attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: opts.isCa },
    opts.isCa
      ? { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true }
      : { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
  ]);
  cert.sign(opts.issuer ? opts.issuer.keys.privateKey : keys.privateKey, forge.md.sha256.create());
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return { der: Uint8Array.from(der, (c) => c.charCodeAt(0)), keys, cert };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await webcrypto.subtle.digest(
    'SHA-256',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function asRoot(slug: string, gen: Gen): Promise<TrustRoot> {
  return {
    slug,
    commonName: gen.cert.subject.getField('CN')?.value ?? slug,
    orgName: `${slug} Org S.A.`,
    country: 'EC',
    pemContent: forge.pki.certificateToPem(gen.cert),
    fingerprintSha256: await sha256Hex(gen.der),
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
    fingerprintSha256: await sha256Hex(gen.der),
    validFrom: gen.cert.validity.notBefore.toISOString(),
    validUntil: gen.cert.validity.notAfter.toISOString(),
  };
}

function buildPki() {
  const now = new Date();
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
    cn: 'PEDRO SIGNER',
    notBefore: new Date(now.getTime() - 1 * YEAR),
    notAfter: new Date(now.getTime() + 1 * YEAR),
    isCa: false,
    serial: '0a1b',
    issuer: inter,
  });
  return { root, inter, leaf };
}

/** Package ONLY the leaf cert + key into a .p12 (no intermediate, no root). */
function leafOnlyP12(leaf: Gen): Uint8Array {
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(leaf.keys.privateKey, [leaf.cert], PIN, {
    algorithm: 'aes256',
    useMac: true,
    count: 2048,
  });
  const der = forge.asn1.toDer(p12Asn1).getBytes();
  return Uint8Array.from(der, (c) => c.charCodeAt(0));
}

async function minimalPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('leaf-only chain test', { x: 50, y: 100, size: 14, font });
  return doc.save({ useObjectStreams: false });
}

const NO_LTV = { timestamp: false, ltv: { longTerm: false, longTermArchive: false } } as const;

describe('leaf-only .p12 → embed/complete subordinate intermediate', () => {
  it('resolveSigningIntermediates appends the bundled intermediate for a leaf-only chain', async () => {
    const { inter, leaf } = buildPki();
    const interFx = await asIntermediate('synth-ca2', 'synth-root', inter);

    const resolved = await resolveSigningIntermediates(leaf.der, [], [interFx]);
    expect(resolved.length).toBe(1);
    expect(await sha256Hex(resolved[0]!)).toBe(await sha256Hex(inter.der));

    // No matching bundle entry → unchanged (no spurious additions).
    const none = await resolveSigningIntermediates(leaf.der, [], []);
    expect(none.length).toBe(0);
  });

  it('verifier-side: leaf-only PDF is invalid without the intermediate, valid once the bundle supplies it', async () => {
    const { root, inter, leaf } = buildPki();
    const rootFx = await asRoot('synth-root', root);
    const interFx = await asIntermediate('synth-ca2', 'synth-root', inter);

    // Sign WITHOUT embedding the intermediate (bundle disabled) → leaf-only CMS.
    const pfx = await parsePfx(leafOnlyP12(leaf), PIN);
    const signed = (
      await signPdfPades(await minimalPdf(), pfx as Parameters<typeof signPdfPades>[1], {
        ...NO_LTV,
        intermediateBundle: [],
      })
    ).signedPdf;

    // Bug reproduction: no intermediate anywhere → chain cannot build → invalid.
    const bug = await verifyPdf(signed, {
      trustRoots: [rootFx],
      trustIntermediates: [],
      fetchOcsp: false,
    });
    expect(bug.status, 'leaf-only sin intermedia debe ser inválida (bug original)').toBe('invalid');
    expect(bug.warnings.some((w) => w.code === 'untrusted_root')).toBe(true);

    // Fix: verifier's bundle supplies the intermediate → chain reaches the root.
    const fixed = await verifyPdf(signed, {
      trustRoots: [rootFx],
      trustIntermediates: [interFx],
      fetchOcsp: false,
    });
    expect(fixed.status, 'con intermedia bundled en el verificador, válida').toBe('valid');
  });

  it('signer-side: signing with the bundle embeds the intermediate → PDF self-contained', async () => {
    const { root, inter, leaf } = buildPki();
    const rootFx = await asRoot('synth-root', root);
    const interFx = await asIntermediate('synth-ca2', 'synth-root', inter);

    // Sign WITH the bundle → the intermediate is embedded in the CMS.
    const pfx = await parsePfx(leafOnlyP12(leaf), PIN);
    const signed = (
      await signPdfPades(await minimalPdf(), pfx as Parameters<typeof signPdfPades>[1], {
        ...NO_LTV,
        intermediateBundle: [interFx],
      })
    ).signedPdf;

    // Verifier has NO bundle, yet the PDF carries its own intermediate → valid.
    const r = await verifyPdf(signed, {
      trustRoots: [rootFx],
      trustIntermediates: [],
      fetchOcsp: false,
    });
    expect(r.status, 'PDF autocontenido valida sin bundle en el verificador').toBe('valid');
  });
});
