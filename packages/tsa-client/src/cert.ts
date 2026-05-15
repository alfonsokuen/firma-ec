/**
 * Minimal cert parsing helper used by requestTimestamp() to surface a
 * ParsedCert from the TSA cert DER without dragging in the full verifier.
 */

import { fromBER } from 'asn1js';
import { Certificate } from 'pkijs';
import type { ParsedCert } from './types';

/**
 * Extract the Common Name (CN) from a pkijs Certificate's RDN array.
 * Returns null if no CN attribute is present.
 */
function extractCN(
  rdns: { typesAndValues: { type: string; value: { valueBlock: { value?: string } } }[] }[],
): string | null {
  for (const rdn of rdns) {
    for (const tv of rdn.typesAndValues) {
      // OID 2.5.4.3 = Common Name
      if (tv.type === '2.5.4.3') {
        const v = tv.value?.valueBlock?.value;
        if (typeof v === 'string') return v;
      }
    }
  }
  return null;
}

export function parseCertFromDer(der: Uint8Array): ParsedCert {
  const ab = der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer;
  const asn = fromBER(ab);
  if (asn.offset === -1) throw new Error('cert ASN.1 decode failed');
  const cert = new Certificate({ schema: asn.result });
  const subjectRdns = cert.subject.typesAndValues
    ? [
        {
          typesAndValues: cert.subject.typesAndValues as unknown as {
            type: string;
            value: { valueBlock: { value?: string } };
          }[],
        },
      ]
    : [];
  const issuerRdns = cert.issuer.typesAndValues
    ? [
        {
          typesAndValues: cert.issuer.typesAndValues as unknown as {
            type: string;
            value: { valueBlock: { value?: string } };
          }[],
        },
      ]
    : [];
  return {
    subjectCN: extractCN(subjectRdns),
    issuerCN: extractCN(issuerRdns),
    der,
    notBefore: cert.notBefore.value as Date,
    notAfter: cert.notAfter.value as Date,
  };
}
