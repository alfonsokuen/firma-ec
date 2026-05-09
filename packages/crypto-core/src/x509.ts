import { Certificate, CertificateChainValidationEngine } from 'pkijs';
import { fromBER } from 'asn1js';
import { oidName } from './oids';

export function parseCertificateDer(der: Uint8Array): Certificate {
  const asn = fromBER(der.buffer as ArrayBuffer);
  if (asn.offset === -1) throw new Error('ASN.1 parse failed');
  return new Certificate({ schema: asn.result });
}

export function parseCertificatePem(pem: string): Certificate {
  const b64 = pem.replace(/-----BEGIN [A-Z ]+-----|-----END [A-Z ]+-----|\s/g, '');
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return parseCertificateDer(der);
}

export interface SubjectInfo {
  cn?: string | undefined;
  o?: string | undefined;
  ou?: string | undefined;
  c?: string | undefined;
  serialNumber?: string | undefined;
  raw: Record<string, string>;
}

export function subjectInfo(cert: Certificate): SubjectInfo {
  const raw: Record<string, string> = {};
  for (const tv of cert.subject.typesAndValues) {
    // tv.value is an asn1js string type — toString() gives the string content
    raw[oidName(tv.type)] = tv.value.toString();
  }
  return {
    cn: raw['CN'],
    o: raw['O'],
    ou: raw['OU'],
    c: raw['C'],
    serialNumber: raw['serialNumber'],
    raw,
  };
}

/** Extract issuer fields from a Certificate (mirrors subjectInfo but reads cert.issuer). */
export function issuerInfo(cert: Certificate): SubjectInfo {
  const raw: Record<string, string> = {};
  for (const tv of cert.issuer.typesAndValues) {
    raw[oidName(tv.type)] = tv.value.toString();
  }
  return {
    cn: raw['CN'],
    o: raw['O'],
    ou: raw['OU'],
    c: raw['C'],
    serialNumber: raw['serialNumber'],
    raw,
  };
}

export function isWithinValidity(cert: Certificate, at: Date): boolean {
  const nb = cert.notBefore.value;
  const na = cert.notAfter.value;
  return at >= nb && at <= na;
}

export interface ChainValidationResult {
  success: boolean;
  chain: Certificate[];
  rootMatched?: Certificate | undefined;
  error?: string | undefined;
}

/** Validate `signerCert` against `trustedCerts` using `intermediateCerts` as helpers.
 *  Returns the full chain when successful. */
export async function validateChain(
  signerCert: Certificate,
  intermediateCerts: Certificate[],
  trustedCerts: Certificate[],
): Promise<ChainValidationResult> {
  const engine = new CertificateChainValidationEngine({
    certs: [signerCert, ...intermediateCerts],
    trustedCerts,
  });
  const result = await engine.verify();
  if (result.result) {
    const path = result.certificatePath as Certificate[] | undefined;
    const lastInPath = path?.[path.length - 1];
    // pkijs typing limitation — certificatePath is typed loosely
    const rootMatched = lastInPath
      ? trustedCerts.find((t) => t.issuer.isEqual((lastInPath as unknown as Certificate).issuer))
      : undefined;
    const result2: ChainValidationResult = { success: true, chain: path ?? [] };
    if (rootMatched !== undefined) result2.rootMatched = rootMatched;
    return result2;
  }
  return {
    success: false,
    chain: [],
    error: result.resultMessage ?? 'unknown chain validation failure',
  };
}
