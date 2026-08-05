import { digest, toHex } from '@firma-ec/crypto-core';
import type { TrustRoot } from '@firma-ec/tsl-ec';
import { fromBER } from 'asn1js';
import forge from 'node-forge';
import { Certificate } from 'pkijs';
import { describe, expect, test } from 'vitest';
import { validatePath } from '../src/pathValidation';

/**
 * chain-incomplete-verdict.test.ts — Fase 0 Paso B (2026-08-05, UANATACA CA2
 * 2021 incident), THEN a same-day CRITICAL security fix after an independent
 * code-reviewer reproduced an exploit.
 *
 * `validatePath` still distinguishes two different chain-build failure
 * SHAPES via `PathResult.chainIncomplete`:
 *
 *   1. chainIncomplete=true  — the leaf→root walk got stuck on a missing
 *      link: no cert in the pool (trusted roots + `intermediates`) resolves
 *      the current issuer.
 *   2. chainIncomplete=false — the walk DOES reach a self-signed cert (every
 *      link is present), but that root simply isn't an accredited ARCOTEL
 *      root in the TSL.
 *
 * IMPORTANT — what changed: `chainIncomplete` used to also soften the
 * verifier's verdict (packages/verifier/src/index.ts) from status='invalid'
 * to status='warning' for case 1, on the theory that it's "probably a real
 * ACE we haven't bundled yet". That theory is false as a SECURITY signal:
 * `intermediates` is populated from certificates the SIGNER embedded in the
 * CMS, which is attacker-controlled. An attacker mints a rogue CA, signs a
 * leaf with it, and simply omits the rogue CA from the PDF — producing case 1
 * exactly, indistinguishable from a legitimate gap in our bundle. Reproduced
 * end-to-end in packages/signer/tests/chain-intermediates.test.ts (Case A:
 * rogue self-signed root emits the leaf directly; Case C: rogue root → rogue
 * subCA → leaf, only the leaf embedded) — both used to yield status='warning'
 * ("Firma válida con advertencias"), now correctly yield status='invalid'.
 *
 * So today BOTH chainIncomplete=true and chainIncomplete=false map to the
 * same hard rejection in index.ts; the field is used ONLY to pick a more
 * honest message (see pathValidation.ts's doc on the field). These tests
 * still assert the two DISTINCT SHAPES at the `validatePath` level (the
 * field itself is a legitimate, useful diagnostic signal for messaging) —
 * they do not assert anything about the downstream verdict severity, which is
 * covered by the signer-side end-to-end tests instead.
 *
 * These tests exercise `validatePath` directly (the single source of truth
 * for `chainIncomplete`) rather than round-tripping a full signed PDF:
 * `@firma-ec/verifier` cannot depend on `@firma-ec/signer` (the signer
 * package already depends on the verifier), so a full sign→verify fixture
 * isn't constructible from this package without a circular workspace
 * dependency.
 */

interface Gen {
  der: Uint8Array;
  keys: forge.pki.rsa.KeyPair;
  cert: forge.pki.Certificate;
}

const YEAR = 365 * 24 * 60 * 60 * 1000;

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

function pkijsCert(der: Uint8Array): Certificate {
  const asn = fromBER(
    der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer,
  );
  if (asn.offset === -1) throw new Error('DER decode failed');
  return new Certificate({ schema: asn.result });
}

function buildPki(now: Date) {
  const root = makeCert({
    cn: 'Synthetic ACE Root 2016',
    notBefore: new Date(now.getTime() - 2 * YEAR),
    notAfter: new Date(now.getTime() + 10 * YEAR),
    isCa: true,
    serial: '01',
  });
  const inter = makeCert({
    cn: 'Synthetic ACE CA2 2021',
    notBefore: new Date(now.getTime() - 2 * YEAR),
    notAfter: new Date(now.getTime() + 8 * YEAR),
    isCa: true,
    serial: '02',
    issuer: root,
  });
  const leaf = makeCert({
    cn: 'MARIA UANATACA TEST',
    notBefore: new Date(now.getTime() - 1 * YEAR),
    notAfter: new Date(now.getTime() + 1 * YEAR),
    isCa: false,
    serial: '0a1b',
    issuer: inter,
  });
  return { root, inter, leaf };
}

describe('validatePath — chainIncomplete distinguishes missing-link from untrusted-root', () => {
  test('leaf-only chain with no resolvable issuer in the pool → chainIncomplete=true', async () => {
    const now = new Date('2026-08-05T00:00:00Z');
    const { root, leaf } = buildPki(now);
    const rootFx = await asRoot('synth-uanataca', root);

    // No intermediate supplied at all — the walk from leaf can't find its
    // issuer (the subordinate CA) anywhere in the pool. This is the exact
    // shape of the real UANATACA CA2 2021 incident before the fix.
    const result = await validatePath(pkijsCert(leaf.der), [], [rootFx], now);

    expect(result.success).toBe(false);
    expect(
      result.chainIncomplete,
      'a genuinely missing intermediate must be reported as chainIncomplete, not a flat rejection',
    ).toBe(true);
  });

  test('full chain reaches a self-signed root, but the root is not trusted → chainIncomplete=false', async () => {
    const now = new Date('2026-08-05T00:00:00Z');
    const { root, inter, leaf } = buildPki(now);
    // The FULL chain is present in the pool (intermediate AND its self-signed
    // issuing root — e.g. a fraudulent CMS that embeds its own root cert), so
    // the leaf→issuer walk can reach a self-signed certificate. The trust
    // store, however, only knows an UNRELATED accredited root — never this
    // synthetic one. This is the "genuinely untrusted / unaccredited CA"
    // shape: every link resolves, the terminal root just isn't ARCOTEL.
    const unrelatedRoot = makeCert({
      cn: 'Unrelated Untrusted Root',
      notBefore: new Date(now.getTime() - 2 * YEAR),
      notAfter: new Date(now.getTime() + 10 * YEAR),
      isCa: true,
      serial: 'ff',
    });
    const unrelatedFx = await asRoot('unrelated', unrelatedRoot);

    const result = await validatePath(
      pkijsCert(leaf.der),
      [pkijsCert(inter.der), pkijsCert(root.der)],
      [unrelatedFx],
      now,
    );

    expect(result.success).toBe(false);
    expect(
      result.chainIncomplete,
      'a chain that fully resolves to a known-but-untrusted root must NOT be softened to chainIncomplete',
    ).toBe(false);
  });

  test('supplying the missing intermediate flips the same leaf from chainIncomplete to success', async () => {
    const now = new Date('2026-08-05T00:00:00Z');
    const { root, inter, leaf } = buildPki(now);
    const rootFx = await asRoot('synth-uanataca', root);

    const withoutInter = await validatePath(pkijsCert(leaf.der), [], [rootFx], now);
    expect(withoutInter.success).toBe(false);
    expect(withoutInter.chainIncomplete).toBe(true);

    const withInter = await validatePath(
      pkijsCert(leaf.der),
      [pkijsCert(inter.der)],
      [rootFx],
      now,
    );
    expect(
      withInter.success,
      'bundling the previously-missing intermediate must resolve the chain',
    ).toBe(true);
    expect(withInter.chainIncomplete).toBe(false);
    expect(withInter.matchedRoot?.slug).toBe('synth-uanataca');
  });
});
