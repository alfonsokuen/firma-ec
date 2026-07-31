import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ecCertIdentity,
  isValidEcCedula,
  parseCertificateDer,
  stripIdPrefix,
  subjectInfo,
} from '@firma-ec/crypto-core';
import { PrintableString } from 'asn1js';
import { AttributeTypeAndValue, Certificate, ContentInfo, SignedData } from 'pkijs';
import { describe, expect, it } from 'vitest';
import { verifyPdf } from '../src/index';

const FIXTURES = join(import.meta.dirname, 'fixtures');

/**
 * Real ACE certificates carry personal data. These tests assert *properties*
 * (shape, checksum, provenance) and never the values themselves, so no cédula
 * is written into the repository.
 */

/** Pull every CMS blob out of a signed PDF's /Contents entries. */
function cmsBlobsOf(pdf: Buffer): Buffer[] {
  const text = pdf.toString('latin1');
  const blobs: Buffer[] = [];
  const re = /\/Contents\s*<([0-9A-Fa-f\s]+)>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const hex = match[1]!.replace(/\s/g, '').replace(/(00)+$/, '');
    if (hex.length < 200) continue;
    blobs.push(Buffer.from(hex.length % 2 ? hex.slice(0, -1) : hex, 'hex'));
  }
  return blobs;
}

function isCa(cert: Certificate): boolean {
  return (
    cert.extensions?.some(
      (e) =>
        e.extnID === '2.5.29.19' && (e.parsedValue as { cA?: boolean } | undefined)?.cA === true,
    ) ?? false
  );
}

/** Leaf certificates issued by `issuerSubstring`, across all signatures. */
function leavesFrom(fixture: string, issuerSubstring: string): Certificate[] {
  const out: Certificate[] = [];
  for (const blob of cmsBlobsOf(readFileSync(join(FIXTURES, fixture)))) {
    let signed: SignedData;
    try {
      signed = new SignedData({ schema: ContentInfo.fromBER(blob).content });
    } catch {
      continue;
    }
    for (const cert of signed.certificates ?? []) {
      if (!(cert instanceof Certificate) || isCa(cert)) continue;
      const issuerCn = cert.issuer.typesAndValues.find((t) => t.type === '2.5.4.3');
      const name = String(issuerCn?.value.valueBlock.value ?? '');
      if (name.includes(issuerSubstring)) out.push(cert);
    }
  }
  return out;
}

/** Minimal certificate carrying only a subject DN serialNumber (OID 2.5.4.5). */
function certWithSubjectSerialNumber(value: string): Certificate {
  const cert = new Certificate();
  cert.subject.typesAndValues.push(
    new AttributeTypeAndValue({ type: '2.5.4.5', value: new PrintableString({ value }) }),
  );
  return cert;
}

describe('isValidEcCedula', () => {
  it('accepts well-formed cédulas', () => {
    // Check digits computed from the mod-10 scheme, not taken from real people.
    expect(isValidEcCedula('1700000001')).toBe(true);
    expect(isValidEcCedula('0920000007')).toBe(true);
  });

  it('rejects a wrong check digit', () => {
    expect(isValidEcCedula('1700000002')).toBe(false);
  });

  it('rejects an out-of-range province', () => {
    expect(isValidEcCedula('9900000001')).toBe(false);
  });

  it('accepts the consular province 30', () => {
    // 3,0,0,0,0,0,0,0,0 × (2,1,2,1,2,1,2,1,2) = 6 → check = 4
    expect(isValidEcCedula('3000000004')).toBe(true);
  });

  it('rejects a company third digit', () => {
    expect(isValidEcCedula('1790000000')).toBe(false);
  });

  it('rejects anything that is not ten digits', () => {
    expect(isValidEcCedula('170000000')).toBe(false);
    expect(isValidEcCedula('17000000012')).toBe(false);
    expect(isValidEcCedula('17000000ab')).toBe(false);
    expect(isValidEcCedula('')).toBe(false);
  });
});

describe('stripIdPrefix', () => {
  it('strips ETSI semantics prefixes', () => {
    expect(stripIdPrefix('IDCEC-1700000001')).toBe('1700000001');
    expect(stripIdPrefix('PNOEC-1700000001')).toBe('1700000001');
    expect(stripIdPrefix('TINEC-1700000001')).toBe('1700000001');
  });

  it('strips ad-hoc prefixes', () => {
    expect(stripIdPrefix('CI-1700000001')).toBe('1700000001');
    expect(stripIdPrefix('RUC-1700000001001')).toBe('1700000001001');
  });

  it('leaves a bare identifier untouched', () => {
    expect(stripIdPrefix('1700000001')).toBe('1700000001');
  });

  it('does not eat a hyphen that is not a prefix', () => {
    expect(stripIdPrefix('AB-1700000001')).toBe('AB-1700000001');
  });
});

describe('ecCertIdentity against real ACE certificates', () => {
  it('ArgosData: reads the cédula the subject DN does not carry', () => {
    const leaves = leavesFrom('eci-real-signed.pdf', 'ArgosData');
    expect(leaves.length).toBeGreaterThan(0);

    for (const cert of leaves) {
      // The old path — this is precisely why the UI rendered an empty field.
      expect(subjectInfo(cert).serialNumber).toBeUndefined();

      const identity = ecCertIdentity(cert);
      expect(identity.ace).toBe('ArgosData');
      expect(identity.cedulaSource).toBe('ace-arc');
      expect(identity.cedula).toMatch(/^\d{10}$/);
      expect(isValidEcCedula(identity.cedula!)).toBe(true);

      // The RUC of a natural person is their cédula plus an establishment code.
      expect(identity.ruc).toMatch(/^\d{13}$/);
      expect(identity.ruc!.startsWith(identity.cedula!)).toBe(true);

      expect(identity.givenName).toBeTruthy();
      expect(identity.surname).toBeTruthy();
      // Two surname attributes are published; both must survive into the join.
      expect(identity.surname!.split(' ').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('Security Data: prefers the arc over the misleading DN serialNumber', () => {
    const leaves = [
      ...leavesFrom('eci-real-contrato2026.pdf', 'SECURITY DATA'),
      ...leavesFrom('eci-real-lideres.pdf', 'SECURITY DATA'),
    ];
    expect(leaves.length).toBeGreaterThan(0);

    for (const cert of leaves) {
      const dnValue = subjectInfo(cert).serialNumber;
      const identity = ecCertIdentity(cert);

      expect(identity.ace).toBe('Security Data');
      expect(identity.cedulaSource).toBe('ace-arc');
      expect(identity.cedula).toMatch(/^\d{10}$/);
      expect(isValidEcCedula(identity.cedula!)).toBe(true);

      // The DN holds something else entirely; taking it would have been wrong.
      expect(dnValue).toBeDefined();
      expect(dnValue).not.toBe(identity.cedula);
    }
  });

  it('ICERT-EC: reads the arc nested inside subjectAltName', () => {
    const leaves = leavesFrom('audit-075-firmado.pdf', 'ICERT-EC');
    expect(leaves.length).toBeGreaterThan(0);

    for (const cert of leaves) {
      const identity = ecCertIdentity(cert);
      expect(identity.ace).toBe('ICERT-EC');
      expect(identity.cedulaSource).toBe('ace-arc');
      expect(identity.cedula).toMatch(/^\d{10}$/);
      expect(isValidEcCedula(identity.cedula!)).toBe(true);

      // ICERT is the one ACE that also fills the DN — the two must agree.
      expect(subjectInfo(cert).serialNumber).toBe(identity.cedula);
    }
  });

  it('verifyPdf surfaces the identity that the UI renders', async () => {
    // The end-to-end path: this is the value bound in Detail.svelte. Asserting
    // on ecCertIdentity alone would not have caught an unwired result field.
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, 'eci-real-signed.pdf')));
    const result = await verifyPdf(bytes, { fetchOcsp: false });

    expect(result.signer).toBeDefined();
    expect(result.signer!.identity.cedula).toMatch(/^\d{10}$/);
    expect(isValidEcCedula(result.signer!.identity.cedula!)).toBe(true);
    expect(result.signer!.identity.ace).toBe('ArgosData');

    // The field the UI used to read, and why it showed a dash.
    expect(result.signer!.cert.subject.serialNumber).toBeUndefined();
  });

  it('Banco Central: the arc wins over a DN serialNumber holding another number', () => {
    const cert = parseCertificateDer(new Uint8Array(readFileSync(join(FIXTURES, 'leaf-bce.der'))));
    const identity = ecCertIdentity(cert);

    expect(identity.ace).toBe('Banco Central del Ecuador');
    expect(identity.cedulaSource).toBe('ace-arc');
    expect(isValidEcCedula(identity.cedula!)).toBe(true);

    // The BCE fills 2.5.4.5 with an internal number, not the cédula. The RUC
    // published alongside is what proves which of the two is the real one.
    expect(subjectInfo(cert).serialNumber).not.toBe(identity.cedula);
    expect(identity.ruc!.startsWith(identity.cedula!)).toBe(true);
  });

  it('Uanataca: reads the arc nested inside subjectAltName', () => {
    const cert = parseCertificateDer(
      new Uint8Array(readFileSync(join(FIXTURES, 'leaf-uanataca.der'))),
    );
    const identity = ecCertIdentity(cert);

    expect(identity.ace).toBe('Uanataca');
    expect(identity.cedulaSource).toBe('ace-arc');
    expect(isValidEcCedula(identity.cedula!)).toBe(true);
    expect(identity.ruc).toMatch(/^\d{13}$/);
  });

  it('never invents a cédula by truncating a company RUC', () => {
    // A natural person's RUC is cédula+001, so its prefix is a valid cédula. A
    // company's is not: truncating it would surface an identifier that belongs
    // to nobody — and Detail.svelte renders `cedula ?? ruc`, so the invented
    // number would win over the correct RUC sitting right next to it.
    for (const ruc of ['1791234567001', '0992339411001', '1760013210001']) {
      const cert = certWithSubjectSerialNumber(ruc);
      const identity = ecCertIdentity(cert);

      expect(isValidEcCedula(ruc.slice(0, 10))).toBe(false); // premise of the test
      expect(identity.cedula).toBeUndefined();
      expect(identity.ruc).toBe(ruc);
    }
  });

  it('accepts a natural-person RUC and derives the cédula from its prefix', () => {
    const cert = certWithSubjectSerialNumber('1700000001001');
    const identity = ecCertIdentity(cert);

    expect(identity.cedula).toBe('1700000001');
    expect(identity.cedulaSource).toBe('subject-dn');
    expect(identity.ruc).toBe('1700000001001');
  });

  it('ignores a DN serialNumber that is not an Ecuadorian identifier at all', () => {
    for (const value of ['02003431350000000000123', '1700000002', 'ABC123']) {
      const identity = ecCertIdentity(certWithSubjectSerialNumber(value));
      expect(identity.cedula).toBeUndefined();
    }
  });

  it('returns an empty identity for a non-Ecuadorian certificate', () => {
    const leaves = leavesFrom('carta-arrendamiento-firmado.pdf', 'freetsa');
    expect(leaves.length).toBeGreaterThan(0);

    for (const cert of leaves) {
      const identity = ecCertIdentity(cert);
      expect(identity.cedula).toBeUndefined();
      expect(identity.ace).toBeUndefined();
    }
  });
});
