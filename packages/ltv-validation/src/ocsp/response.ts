/**
 * OCSP response parser per RFC 6960.
 *
 * Returns a structured view of the BasicOCSPResponse:
 *   - certId: hex-encoded {issuerNameHash, issuerKeyHash, serialNumber}
 *   - certStatus: 'good' | 'revoked' | 'unknown'
 *   - thisUpdate / nextUpdate / revokedAt / producedAt
 *   - signatureValid: signature over tbsResponseData verified against responder cert
 *   - responderCert: the cert that signed the response (delegate or issuer itself)
 *
 * Browser-compatible: uses asn1js + pkijs + globalThis.crypto.subtle only.
 */

import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import type { ParsedCert, RevocationStatus } from '../types';

const OID_BASIC_OCSP_RESPONSE = '1.3.6.1.5.5.7.48.1.1';
/** id-kp-OCSPSigning */
const OID_OCSP_SIGNING_EKU = '1.3.6.1.5.5.7.3.9';

export interface ParsedOcspResponse {
  /** Hex of issuerNameHash + issuerKeyHash + serial (concatenated). Used as cache key fragment. */
  certIdHex: string;
  /** issuerNameHash hex */
  issuerNameHashHex: string;
  /** issuerKeyHash hex */
  issuerKeyHashHex: string;
  /** Serial as hex (no leading zero stripping). */
  serialHex: string;
  certStatus: RevocationStatus;
  producedAt: Date;
  thisUpdate: Date;
  nextUpdate?: Date;
  revokedAt?: Date;
  signatureValid: boolean;
  /** Responder cert when present in the response certificates field; else null (caller should default to issuer). */
  responderCert: ParsedCert | null;
  /** Whether the responder cert carries the id-kp-OCSPSigning EKU. */
  responderHasOcspSigningEku: boolean;
}

export class OcspParseError extends Error {
  constructor(
    message: string,
    public detail?: string,
  ) {
    super(message);
    this.name = 'OcspParseError';
  }
}

function toAB(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function bufToHex(buf: ArrayBuffer | Uint8Array): string {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < u.length; i++) {
    const b = u[i] ?? 0;
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

function pkijsCertFromDer(der: Uint8Array): pkijs.Certificate {
  const asn = asn1js.fromBER(toAB(der));
  if (asn.offset === -1) throw new OcspParseError('cert ASN.1 decode failed');
  return new pkijs.Certificate({ schema: asn.result });
}

function parsedCertFromPkijs(c: pkijs.Certificate): ParsedCert {
  const der = new Uint8Array(c.toSchema(true).toBER(false));
  const subjectCN = extractCN(c.subject.typesAndValues);
  const issuerCN = extractCN(c.issuer.typesAndValues);
  return {
    subjectCN,
    issuerCN,
    der,
    notBefore: c.notBefore.value as Date,
    notAfter: c.notAfter.value as Date,
  };
}

function extractCN(
  tv: { type: string; value: { valueBlock: { value?: string } } }[] | undefined,
): string | null {
  if (!tv) return null;
  for (const e of tv) {
    if (e.type === '2.5.4.3') {
      const v = e.value?.valueBlock?.value;
      if (typeof v === 'string') return v;
    }
  }
  return null;
}

function hasOcspSigningEku(cert: pkijs.Certificate): boolean {
  const exts = cert.extensions ?? [];
  for (const ext of exts) {
    if (ext.extnID !== '2.5.29.37') continue; // id-ce-extKeyUsage
    const parsed = ext.parsedValue as { keyPurposes?: string[] } | undefined;
    if (parsed?.keyPurposes?.includes(OID_OCSP_SIGNING_EKU)) return true;
  }
  return false;
}

/**
 * Parse + verify an OCSP response (DER bytes).
 *
 * Verifier checks:
 *   1. responseStatus === successful (0).
 *   2. responseType === id-pkix-ocsp-basic.
 *   3. BasicOCSPResponse signature verifies over tbsResponseData using:
 *      - responder cert from `certs[]` if present, OR
 *      - issuerCert if responder is the issuer itself (responderID matches).
 *
 * `signatureValid` reflects (3). When false, caller should reject.
 *
 * @param der raw DER bytes of OCSPResponse (NOT BasicOCSPResponse).
 * @param issuerCert issuing CA — used when delegate responder cert is absent
 *                   and to validate the delegate's chain (caller's responsibility
 *                   to enforce that responderCert is signed by issuerCert).
 */
export async function parseOcspResponse(
  der: Uint8Array,
  issuerCert: ParsedCert,
): Promise<ParsedOcspResponse> {
  const asn = asn1js.fromBER(toAB(der));
  if (asn.offset === -1) throw new OcspParseError('OCSPResponse ASN.1 decode failed');
  const ocspResp = new pkijs.OCSPResponse({ schema: asn.result });

  const status = ocspResp.responseStatus.valueBlock.valueDec;
  if (status !== 0) {
    throw new OcspParseError(`OCSP responseStatus = ${status}`);
  }
  const respBytes = ocspResp.responseBytes;
  if (!respBytes) throw new OcspParseError('OCSP responseBytes missing');
  if (respBytes.responseType !== OID_BASIC_OCSP_RESPONSE) {
    throw new OcspParseError(`unexpected responseType ${respBytes.responseType}`);
  }

  const innerHex = (respBytes.response.valueBlock as { valueHex: ArrayBuffer }).valueHex;
  const basicAsn = asn1js.fromBER(innerHex);
  if (basicAsn.offset === -1) throw new OcspParseError('BasicOCSPResponse decode failed');
  const basic = new pkijs.BasicOCSPResponse({ schema: basicAsn.result });

  const single = basic.tbsResponseData.responses[0];
  if (!single) throw new OcspParseError('no SingleResponse');

  // CertID extraction
  const certID = single.certID;
  const issuerNameHashHex = bufToHex(
    (certID.issuerNameHash.valueBlock as { valueHex: ArrayBuffer }).valueHex,
  );
  const issuerKeyHashHex = bufToHex(
    (certID.issuerKeyHash.valueBlock as { valueHex: ArrayBuffer }).valueHex,
  );
  const serialHex = bufToHex(
    (certID.serialNumber.valueBlock as { valueHex: ArrayBuffer }).valueHex,
  );

  // certStatus discrimination
  const cs = single.certStatus as unknown as {
    idBlock?: { tagNumber?: number };
    revocationTime?: { value: Date };
  };
  let certStatus: RevocationStatus = 'unknown';
  let revokedAt: Date | undefined;
  if (cs.idBlock?.tagNumber === 0) certStatus = 'good';
  else if (cs.idBlock?.tagNumber === 1) {
    certStatus = 'revoked';
    revokedAt = cs.revocationTime?.value;
  } else certStatus = 'unknown';

  const producedAt = basic.tbsResponseData.producedAt as Date;
  const thisUpdate = single.thisUpdate as Date;
  const nextUpdate = single.nextUpdate as Date | undefined;

  // Resolve responder cert
  const respCertsAsn1 = basic.certs ?? [];
  let responderPkiCert: pkijs.Certificate | null = null;
  if (respCertsAsn1.length > 0) {
    responderPkiCert = respCertsAsn1[0]!;
  }

  // Verify signature: pkijs BasicOCSPResponse.verify accepts a candidate cert.
  let signatureValid = false;
  try {
    const issuerPki = pkijsCertFromDer(issuerCert.der);
    if (responderPkiCert) {
      signatureValid = await basic.verify({ trustedCerts: [issuerPki] });
    } else {
      // Responder = issuer itself
      signatureValid = await basic.verify({ trustedCerts: [issuerPki] });
    }
  } catch {
    signatureValid = false;
  }

  const responderCert = responderPkiCert ? parsedCertFromPkijs(responderPkiCert) : null;
  const responderHasOcspSigningEku = responderPkiCert ? hasOcspSigningEku(responderPkiCert) : false;

  const result: ParsedOcspResponse = {
    certIdHex: issuerNameHashHex + issuerKeyHashHex + serialHex,
    issuerNameHashHex,
    issuerKeyHashHex,
    serialHex,
    certStatus,
    producedAt,
    thisUpdate,
    signatureValid,
    responderCert,
    responderHasOcspSigningEku,
  };
  if (nextUpdate !== undefined) result.nextUpdate = nextUpdate;
  if (revokedAt !== undefined) result.revokedAt = revokedAt;
  return result;
}
