/**
 * OCSP request builder per RFC 6960.
 *
 * Browser-compatible: uses asn1js + pkijs only (no node:* imports).
 *
 * The request consists of an OCSPRequest containing a single Request entry
 * whose `reqCert` (CertID) is built via pkijs `OCSPRequest.createForCertificate`,
 * which hashes the issuer's name + key and pulls the serial from the subject cert.
 *
 * Nonce extension (id-pkix-ocsp-nonce, OID 1.3.6.1.5.5.7.48.1.2) is OFF by default
 * because many ARCOTEL ECI responders reject requests with nonce extension. Caller
 * may opt in via `opts.nonce === true`.
 */

import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import type { ParsedCert } from '../types';

/** id-pkix-ocsp-nonce */
const OID_OCSP_NONCE = '1.3.6.1.5.5.7.48.1.2';

export interface BuildOcspRequestOpts {
  /** CertID hash algorithm. Default 'sha1' (broadly supported by ARCOTEL responders). */
  hashAlgo?: 'sha1' | 'sha256';
  /** Add nonce extension. Default false. */
  nonce?: boolean;
}

export interface BuildOcspRequestResult {
  requestDer: Uint8Array;
  /** Raw nonce bytes when included; null otherwise. */
  nonce: Uint8Array | null;
  /**
   * Hex of the request CertID's `issuerKeyHash`. Derived here (not by the
   * caller) so a cache lookup performed BEFORE the round trip keys on exactly
   * the same value `parseOcspResponse` reports afterwards — the responder
   * echoes the CertID verbatim (RFC 6960 §4.2.1).
   */
  issuerKeyHashHex: string;
  /** Hex of the request CertID's `serialNumber`. Same rationale as above. */
  serialHex: string;
}

function toAB(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function bufToHex(buf: ArrayBuffer | Uint8Array): string {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < u.length; i++) {
    out += (u[i] ?? 0).toString(16).padStart(2, '0');
  }
  return out;
}

function pkijsCertFromDer(der: Uint8Array): pkijs.Certificate {
  const asn = asn1js.fromBER(toAB(der));
  if (asn.offset === -1) throw new Error('cert ASN.1 decode failed');
  return new pkijs.Certificate({ schema: asn.result });
}

/**
 * Build an OCSPRequest DER for `cert` issued by `issuerCert`.
 *
 * @returns DER-encoded OCSPRequest + the nonce bytes (when present) for caller-side
 * matching against the response's nonce extension.
 */
export async function buildOcspRequest(
  cert: ParsedCert,
  issuerCert: ParsedCert,
  opts: BuildOcspRequestOpts = {},
): Promise<BuildOcspRequestResult> {
  const hashAlgo = opts.hashAlgo ?? 'sha1';
  const wantNonce = opts.nonce === true;

  const subject = pkijsCertFromDer(cert.der);
  const issuer = pkijsCertFromDer(issuerCert.der);

  const req = new pkijs.OCSPRequest();
  // pkijs createForCertificate handles issuerNameHash + issuerKeyHash + serial.
  await req.createForCertificate(subject, {
    issuerCertificate: issuer,
    hashAlgorithm: hashAlgo === 'sha256' ? 'SHA-256' : 'SHA-1',
  });

  let nonce: Uint8Array | null = null;
  if (wantNonce) {
    nonce = new Uint8Array(16);
    globalThis.crypto.getRandomValues(nonce);
    // RFC 6960 §4.4.1: the Nonce extnValue is the OCTET STRING of the nonce
    // wrapped in another OCTET STRING (extnValue is OCTET STRING containing DER).
    const innerOctet = new asn1js.OctetString({ valueHex: toAB(nonce) });
    const ext = new pkijs.Extension({
      extnID: OID_OCSP_NONCE,
      critical: false,
      extnValue: innerOctet.toBER(false),
    });
    req.tbsRequest.requestExtensions = [ext];
  }

  const reqCert = req.tbsRequest.requestList?.[0]?.reqCert;
  if (!reqCert) throw new Error('OCSPRequest built without a CertID');
  const issuerKeyHashHex = bufToHex(
    (reqCert.issuerKeyHash.valueBlock as { valueHex: ArrayBuffer }).valueHex,
  );
  const serialHex = bufToHex(
    (reqCert.serialNumber.valueBlock as { valueHex: ArrayBuffer }).valueHex,
  );

  const der = req.toSchema(true).toBER(false);
  return { requestDer: new Uint8Array(der), nonce, issuerKeyHashHex, serialHex };
}
