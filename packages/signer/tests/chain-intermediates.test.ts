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
import * as asn1js from 'asn1js';
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

const OID_AIA = '1.3.6.1.5.5.7.1.1';
const OID_AD_CA_ISSUERS = '1.3.6.1.5.5.7.48.2';

function uint8ToBinLocal(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i] ?? 0);
  return s;
}

function toArrayBufferLocal(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

/** Build the extnValue OCTET STRING contents for an AIA extension with a
 *  single caIssuers AccessDescription (RFC 5280 §4.2.2.1). */
function buildCaIssuersAiaExtnValueDer(url: string): string {
  const uriBytes = new Uint8Array(url.length);
  for (let i = 0; i < url.length; i++) uriBytes[i] = url.charCodeAt(i) & 0xff;
  const accessLocation = new asn1js.Primitive({
    idBlock: { tagClass: 3, tagNumber: 6 } as never, // [6] context-specific, IA5String IMPLICIT
    valueHex: toArrayBufferLocal(uriBytes),
  });
  const accessDescription = new asn1js.Sequence({
    value: [new asn1js.ObjectIdentifier({ value: OID_AD_CA_ISSUERS }), accessLocation],
  });
  const aia = new asn1js.Sequence({ value: [accessDescription] });
  return uint8ToBinLocal(new Uint8Array(aia.toBER(false)));
}

function makeCert(opts: {
  cn: string;
  notBefore: Date;
  notAfter: Date;
  isCa: boolean;
  serial: string;
  issuer?: Gen;
  /** F1 — when set, embeds a caIssuers AIA extension pointing at this URL
   *  (the AIA fallback resolves the cert's OWN issuer via this URL). */
  caIssuersAiaUrl?: string;
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
  const extensions: forge.pki.CertificateExtension[] = [
    { name: 'basicConstraints', cA: opts.isCa } as forge.pki.CertificateExtension,
    (opts.isCa
      ? { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true }
      : {
          name: 'keyUsage',
          digitalSignature: true,
          nonRepudiation: true,
        }) as forge.pki.CertificateExtension,
  ];
  if (opts.caIssuersAiaUrl) {
    extensions.push({
      id: OID_AIA,
      critical: false,
      value: buildCaIssuersAiaExtnValueDer(opts.caIssuersAiaUrl),
    } as unknown as forge.pki.CertificateExtension);
  }
  cert.setExtensions(extensions);
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

const AIA_URL = 'http://aia.example.com/synth-ca2.crt';
const AIA_ROOT_URL = 'http://aia.example.com/synth-root.crt';

/**
 * Same 3-level PKI as {@link buildPki}, but BOTH the leaf and the
 * intermediate carry a caIssuers AIA extension (leaf → {@link AIA_URL},
 * inter → {@link AIA_ROOT_URL}) — the shape F1's fallback resolves at each
 * hop, matching how a real subCA typically also publishes its own AIA up to
 * its root.
 */
function buildPkiWithLeafAia() {
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
    caIssuersAiaUrl: AIA_ROOT_URL,
  });
  const leaf = makeCert({
    cn: 'PEDRO SIGNER',
    notBefore: new Date(now.getTime() - 1 * YEAR),
    notAfter: new Date(now.getTime() + 1 * YEAR),
    isCa: false,
    serial: '0a1b',
    issuer: inter,
    caIssuersAiaUrl: AIA_URL,
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
    const { root, inter, leaf } = buildPki();
    const interFx = await asIntermediate('synth-ca2', 'synth-root', inter);
    const rootFx = await asRoot('synth-root', root);

    // AIA fallback disabled here: these are synthetic certs with no AIA
    // extension, but disabling explicitly keeps this a pure bundle-only test.
    // 2026-08-05 P0 fix (found by an independent silent-failure-hunter pass):
    // `complete` used to require literally embedding a self-signed cert, but
    // `getIntermediates()` never contains one — roots live in a separate
    // bundle this function didn't consult, so EVERY real signature came back
    // `complete: false`, root included or not. Passing the trust-anchor root
    // here (5th arg) is what lets `complete` become true WITHOUT embedding
    // the root itself (PAdES convention: ship up to, not including, the
    // anchor) — see the two assertions below.
    const resolved = await resolveSigningIntermediates(leaf.der, [], [interFx], null, [rootFx]);
    expect(resolved.complete).toBe(true); // issuer of the bridged subCA is a known root
    expect(resolved.ders.length).toBe(1); // only the subCA embedded, never the root
    expect(await sha256Hex(resolved.ders[0]!)).toBe(await sha256Hex(inter.der));

    // Root NOT passed → walk still can't tell the chain is complete (this is
    // the pre-fix shape, still correct when the caller truly has no root
    // bundle available).
    const noRoot = await resolveSigningIntermediates(leaf.der, [], [interFx], null, []);
    expect(noRoot.complete).toBe(false);
    expect(noRoot.ders.length).toBe(1);

    // No matching bundle entry, no AIA → unchanged (no spurious additions).
    const none = await resolveSigningIntermediates(leaf.der, [], [], null, []);
    expect(none.complete).toBe(false);
    expect(none.ders.length).toBe(0);
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

    // Bug reproduction: no intermediate anywhere → chain cannot build.
    // 2026-08-05 (Fase 0 Paso B, UANATACA CA2 2021 incident, then CRITICAL
    // fix same day): a leaf-only CMS whose issuing subordinate CA isn't
    // bundled still rejects HARD (status 'invalid'). An earlier version of
    // this fix softened it to 'warning', but the pool used to walk the chain
    // includes attacker-embedded CMS content — an attacker can trivially
    // produce this exact shape with a rogue CA and get treated as "maybe
    // legitimate, just needs an app update". Only the MESSAGE is honest about
    // there being two possible causes; the verdict is the same hard rejection
    // as `untrusted_root`. See packages/verifier/tests/
    // chain-incomplete-verdict.test.ts for the direct chainIncomplete unit
    // tests, and the two rogue-CA end-to-end reproductions below.
    const bug = await verifyPdf(signed, {
      trustRoots: [rootFx],
      trustIntermediates: [],
      fetchOcsp: false,
    });
    expect(bug.status, 'leaf-only sin intermedia bundleada: rechazo duro, no warning').toBe(
      'invalid',
    );
    expect(bug.warnings.some((w) => w.code === 'CHAIN_INCOMPLETE_UNKNOWN_INTERMEDIATE')).toBe(true);

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

  // 2026-08-05 CRITICAL fix — rogue-CA end-to-end reproductions. Reported by
  // an independent code-reviewer: before this fix, an attacker who mints
  // their own CA and simply does NOT embed it in the CMS produced the exact
  // same shape as a legitimate not-yet-bundled ACE intermediate, and the
  // verifier softened the verdict to 'warning' ("Firma válida con
  // advertencias") — indistinguishable from a real signature. Both cases must
  // reject HARD, because the pool the leaf→root walk climbs
  // (`trustedCerts + intermediates`) is built from CMS content the signer —
  // i.e. potentially the attacker — controls.
  it('rogue self-signed root emits the leaf directly, root NOT embedded → hard rejection (Case A)', async () => {
    const rogueRoot = makeCert({
      cn: 'Rogue Attacker Root',
      notBefore: new Date(Date.now() - 2 * YEAR),
      notAfter: new Date(Date.now() + 10 * YEAR),
      isCa: true,
      serial: '01',
    });
    const rogueLeaf = makeCert({
      cn: 'ATTACKER SIGNER',
      notBefore: new Date(Date.now() - 1 * YEAR),
      notAfter: new Date(Date.now() + 1 * YEAR),
      isCa: false,
      serial: '02',
      issuer: rogueRoot,
    });

    // Sign with a leaf-only .p12 and no intermediate bundle → the CMS embeds
    // ONLY the rogue leaf, never the rogue root.
    const pfx = await parsePfx(leafOnlyP12(rogueLeaf), PIN);
    const signed = (
      await signPdfPades(await minimalPdf(), pfx as Parameters<typeof signPdfPades>[1], {
        ...NO_LTV,
        intermediateBundle: [],
      })
    ).signedPdf;

    // Verify against real-shaped (but unrelated) trust roots — the rogue root
    // is never in the verifier's trust store, and never embedded either.
    const { root: legitRoot } = buildPki();
    const legitRootFx = await asRoot('legit-unrelated-root', legitRoot);

    const result = await verifyPdf(signed, {
      trustRoots: [legitRootFx],
      trustIntermediates: [],
      fetchOcsp: false,
    });

    expect(
      result.status,
      'a rogue root that simply omits itself from the CMS must be rejected, not softened',
    ).toBe('invalid');
    expect(result.warnings.some((w) => w.code === 'CHAIN_INCOMPLETE_UNKNOWN_INTERMEDIATE')).toBe(
      true,
    );
  });

  it('rogue root → rogue subCA → leaf, only the leaf embedded → hard rejection (Case C)', async () => {
    const rogueRoot = makeCert({
      cn: 'Rogue Attacker Root C',
      notBefore: new Date(Date.now() - 2 * YEAR),
      notAfter: new Date(Date.now() + 10 * YEAR),
      isCa: true,
      serial: '01',
    });
    const rogueSubCa = makeCert({
      cn: 'Rogue Attacker SubCA C',
      notBefore: new Date(Date.now() - 2 * YEAR),
      notAfter: new Date(Date.now() + 8 * YEAR),
      isCa: true,
      serial: '02',
      issuer: rogueRoot,
    });
    const rogueLeaf = makeCert({
      cn: 'ATTACKER SIGNER C',
      notBefore: new Date(Date.now() - 1 * YEAR),
      notAfter: new Date(Date.now() + 1 * YEAR),
      isCa: false,
      serial: '03',
      issuer: rogueSubCa,
    });

    // Leaf-only .p12, no intermediate bundle → CMS embeds ONLY the leaf, never
    // the rogue subCA nor the rogue root.
    const pfx = await parsePfx(leafOnlyP12(rogueLeaf), PIN);
    const signed = (
      await signPdfPades(await minimalPdf(), pfx as Parameters<typeof signPdfPades>[1], {
        ...NO_LTV,
        intermediateBundle: [],
      })
    ).signedPdf;

    const { root: legitRoot } = buildPki();
    const legitRootFx = await asRoot('legit-unrelated-root-c', legitRoot);

    const result = await verifyPdf(signed, {
      trustRoots: [legitRootFx],
      trustIntermediates: [],
      fetchOcsp: false,
    });

    expect(
      result.status,
      'a rogue subCA chain that only embeds the leaf must be rejected, not softened',
    ).toBe('invalid');
    expect(result.warnings.some((w) => w.code === 'CHAIN_INCOMPLETE_UNKNOWN_INTERMEDIATE')).toBe(
      true,
    );
  });
});

// F1 (2026-08-05) — AIA caIssuers fallback: when the bundle doesn't have the
// missing intermediate, resolveSigningIntermediates now tries the leaf's own
// AIA URL before giving up. Systemic version of the F0 hotfix.
describe('F1 — AIA caIssuers fallback', () => {
  function forgeCertToDer(cert: forge.pki.Certificate): Uint8Array {
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    return Uint8Array.from(der, (c) => c.charCodeAt(0));
  }

  it('bundle miss + AIA resolves the intermediate, whose issuer is an independently-trusted root → complete: true, only the intermediate embedded', async () => {
    const { inter, root, leaf } = buildPkiWithLeafAia();
    const interDer = forgeCertToDer(inter.cert);
    const rootDer = forgeCertToDer(root.cert);

    const calledUrls: string[] = [];
    const fetchImpl = (async (u: string) => {
      calledUrls.push(u);
      const bodyDer = u === AIA_URL ? interDer : u === AIA_ROOT_URL ? rootDer : new Uint8Array(0);
      const ab = bodyDer.buffer.slice(bodyDer.byteOffset, bodyDer.byteOffset + bodyDer.byteLength);
      return new Response(ab, {
        status: 200,
        headers: { 'content-length': String(bodyDer.byteLength) },
      });
    }) as unknown as typeof globalThis.fetch;

    // Empty bundle — the ONLY way to bridge leaf → inter is via AIA (AIA_URL).
    // `root` is passed as an INDEPENDENTLY trusted root (5th param) — i.e. this
    // app already trusts it via its own roots bundle, same as any bundled ACE
    // root. The walk must recognise that WITHOUT needing to query the root's
    // own AIA_ROOT_URL: it already knows inter's issuer is a trust anchor.
    const resolved = await resolveSigningIntermediates(leaf.der, [], [], { fetchImpl }, [
      await asRoot('synth-root', root),
    ]);
    expect(
      calledUrls,
      'AIA_ROOT_URL must never be queried — the root is already known locally',
    ).toEqual([AIA_URL]);
    expect(resolved.complete).toBe(true);
    expect(resolved.missingIssuerDn).toBeUndefined();
    expect(resolved.ders.length, 'only the intermediate is embedded, never the root').toBe(1);
    expect(await sha256Hex(resolved.ders[0]!)).toBe(await sha256Hex(inter.der));
  });

  // 2026-08-05 HIGH fix (independent Fable review): a self-signed cert
  // resolved via AIA used to be embedded unconditionally and the walk
  // reported `complete: true` regardless of whether this app actually
  // trusts it — AIA can only ever complete a chain toward an
  // ALREADY-trusted root (see the module header's trust boundary), never
  // discover a NEW one. Reproduces the false-negative directly: a
  // responder that serves a self-signed cert this app does NOT know as a
  // root must never be treated as "chain complete".
  it('AIA resolves a self-signed cert that is NOT a known trust anchor → complete: false, never embedded, never grants trust', async () => {
    const { inter, root, leaf } = buildPkiWithLeafAia();
    const interDer = forgeCertToDer(inter.cert);
    const rootDer = forgeCertToDer(root.cert);

    const fetchImpl = (async (u: string) => {
      const bodyDer = u === AIA_URL ? interDer : u === AIA_ROOT_URL ? rootDer : new Uint8Array(0);
      const ab = bodyDer.buffer.slice(bodyDer.byteOffset, bodyDer.byteOffset + bodyDer.byteLength);
      return new Response(ab, {
        status: 200,
        headers: { 'content-length': String(bodyDer.byteLength) },
      });
    }) as unknown as typeof globalThis.fetch;

    // No `roots` override → the production @firma-ec/tsl-ec root bundle,
    // which (correctly) has never heard of this synthetic root.
    const resolved = await resolveSigningIntermediates(leaf.der, [], [], { fetchImpl });
    expect(
      resolved.complete,
      'a self-signed cert this app does not independently trust must never mark the chain complete',
    ).toBe(false);
    expect(resolved.ders.length, 'the untrusted root must never be embedded').toBe(1);
    expect(await sha256Hex(resolved.ders[0]!)).toBe(await sha256Hex(inter.der));
    expect(resolved.missingIssuerDn).toContain('Synthetic ACE Root 2016');
  });

  it('bundle miss + AIA also misses (network error) → complete: false, no-network behaviour intact', async () => {
    const { leaf } = buildPkiWithLeafAia();
    const fetchImpl = (async () => {
      throw new Error('simulated network failure');
    }) as unknown as typeof globalThis.fetch;

    const resolved = await resolveSigningIntermediates(leaf.der, [], [], { fetchImpl });
    expect(resolved.complete).toBe(false);
    expect(resolved.ders.length).toBe(0);
    expect(resolved.missingIssuerDn).toContain('Synthetic ACE CA2 2016');
  });

  it('AIA returns a cert that does NOT cryptographically verify (rogue) → rejected, complete: false, never embedded', async () => {
    const { leaf } = buildPkiWithLeafAia();

    // Rogue CA: same subject DN as the real intermediate, but a different key
    // — an attacker-controlled responder trying to slip in a lookalike cert.
    const rogueKeys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const rogueCert = forge.pki.createCertificate();
    rogueCert.publicKey = rogueKeys.publicKey;
    rogueCert.serialNumber = '99';
    rogueCert.validity.notBefore = new Date(Date.now() - YEAR);
    rogueCert.validity.notAfter = new Date(Date.now() + YEAR);
    rogueCert.setSubject([{ name: 'commonName', value: 'Synthetic ACE CA2 2016' }]);
    rogueCert.setIssuer([{ name: 'commonName', value: 'Synthetic ACE CA2 2016' }]);
    rogueCert.setExtensions([
      { name: 'basicConstraints', cA: true } as forge.pki.CertificateExtension,
    ]);
    rogueCert.sign(rogueKeys.privateKey, forge.md.sha256.create());
    const rogueDer = forgeCertToDer(rogueCert);

    const fetchImpl = (async () => {
      const ab = rogueDer.buffer.slice(
        rogueDer.byteOffset,
        rogueDer.byteOffset + rogueDer.byteLength,
      );
      return new Response(ab, {
        status: 200,
        headers: { 'content-length': String(rogueDer.byteLength) },
      });
    }) as unknown as typeof globalThis.fetch;

    const resolved = await resolveSigningIntermediates(leaf.der, [], [], { fetchImpl });
    expect(
      resolved.complete,
      'a non-verifying AIA response must never be treated as resolved',
    ).toBe(false);
    expect(resolved.ders.length).toBe(0);
    // The rogue cert's bytes must never appear in the output.
    expect(resolved.ders.some((d) => d.length === rogueDer.length)).toBe(false);
  });

  it('aiaOpts: null disables the fallback — behaves exactly like pre-F1 (no fetch attempted)', async () => {
    const { leaf } = buildPkiWithLeafAia();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('must not fetch when aiaOpts is null');
    }) as unknown as typeof globalThis.fetch;
    try {
      const resolved = await resolveSigningIntermediates(leaf.der, [], [], null);
      expect(resolved.complete).toBe(false);
      expect(resolved.ders.length).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 2026-08-05 HIGH-3 fix (independent code-reviewer pass on F1): the AIA
  // walk previously had NO aggregate ceiling — each of its up to 8 hops got
  // the full per-request timeout independently, so a slow-but-not-timing-out
  // responder at every hop could consume far more time than the document's
  // own signing budget allowed (defect #1's failure mode, unguarded for this
  // leg). `deadlineAt` bounds the WHOLE walk, not just one hop.
  it('deadlineAt already exhausted → the AIA hop is never attempted, walk gives up exactly like a network failure', async () => {
    const { leaf } = buildPkiWithLeafAia();
    const fetchImpl = (() => {
      throw new Error('must not fetch once the aggregate AIA deadline is exhausted');
    }) as unknown as typeof globalThis.fetch;

    const resolved = await resolveSigningIntermediates(leaf.der, [], [], {
      fetchImpl,
      deadlineAt: Date.now() - 1,
    });
    expect(resolved.complete).toBe(false);
    expect(resolved.ders.length).toBe(0);
    expect(resolved.missingIssuerDn).toContain('Synthetic ACE CA2 2016');
  });

  it('deadlineAt with plenty of time left resolves normally (does not clamp away a healthy budget)', async () => {
    const { inter, root, leaf } = buildPkiWithLeafAia();
    const interDer = forgeCertToDer(inter.cert);
    const rootDer = forgeCertToDer(root.cert);
    const fetchImpl = (async (u: string) => {
      const bodyDer = u === AIA_URL ? interDer : u === AIA_ROOT_URL ? rootDer : new Uint8Array(0);
      const ab = bodyDer.buffer.slice(bodyDer.byteOffset, bodyDer.byteOffset + bodyDer.byteLength);
      return new Response(ab, {
        status: 200,
        headers: { 'content-length': String(bodyDer.byteLength) },
      });
    }) as unknown as typeof globalThis.fetch;

    const resolved = await resolveSigningIntermediates(
      leaf.der,
      [],
      [],
      { fetchImpl, deadlineAt: Date.now() + 10_000 },
      [await asRoot('synth-root', root)],
    );
    expect(resolved.complete).toBe(true);
    expect(resolved.ders.length).toBe(1);
  });
});
