/**
 * Authority Information Access (RFC 5280 §4.2.2.1) + CRL Distribution Points
 * (RFC 5280 §4.2.1.13) URL extraction.
 *
 * Used to discover OCSP responder URLs and CRL distribution point URLs from
 * the cert without hardcoding ARCOTEL ECI endpoints.
 */

import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import type { ParsedCert } from '../types';

const OID_AIA = '1.3.6.1.5.5.7.1.1';
const OID_AD_OCSP = '1.3.6.1.5.5.7.48.1';
const OID_AD_CA_ISSUERS = '1.3.6.1.5.5.7.48.2';
const OID_CRL_DP = '2.5.29.31';

function toAB(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function loadPkijs(cert: ParsedCert): pkijs.Certificate {
  const asn = asn1js.fromBER(toAB(cert.der));
  if (asn.offset === -1) throw new Error('cert ASN.1 decode failed');
  return new pkijs.Certificate({ schema: asn.result });
}

function extractUriFromGeneralName(gn: unknown): string | null {
  // GeneralName CHOICE; uniformResourceIdentifier is [6] IA5String
  const g = gn as {
    type?: number;
    value?: string | { valueBlock?: { value?: string } };
  };
  if (g?.type !== 6) return null;
  if (typeof g.value === 'string') return g.value;
  const v = g.value?.valueBlock?.value;
  return typeof v === 'string' ? v : null;
}

export function extractOcspUrls(cert: ParsedCert): string[] {
  const c = loadPkijs(cert);
  const exts = c.extensions ?? [];
  const out: string[] = [];
  for (const ext of exts) {
    if (ext.extnID !== OID_AIA) continue;
    const parsed = ext.parsedValue as
      | { accessDescriptions?: { accessMethod: string; accessLocation: unknown }[] }
      | undefined;
    const ads = parsed?.accessDescriptions ?? [];
    for (const ad of ads) {
      if (ad.accessMethod !== OID_AD_OCSP) continue;
      const uri = extractUriFromGeneralName(ad.accessLocation);
      if (uri) out.push(uri);
    }
  }
  return out;
}

export function extractCaIssuersUrls(cert: ParsedCert): string[] {
  const c = loadPkijs(cert);
  const exts = c.extensions ?? [];
  const out: string[] = [];
  for (const ext of exts) {
    if (ext.extnID !== OID_AIA) continue;
    const parsed = ext.parsedValue as
      | { accessDescriptions?: { accessMethod: string; accessLocation: unknown }[] }
      | undefined;
    const ads = parsed?.accessDescriptions ?? [];
    for (const ad of ads) {
      if (ad.accessMethod !== OID_AD_CA_ISSUERS) continue;
      const uri = extractUriFromGeneralName(ad.accessLocation);
      if (uri) out.push(uri);
    }
  }
  return out;
}

export function extractCrlDistributionPoints(cert: ParsedCert): string[] {
  const c = loadPkijs(cert);
  const exts = c.extensions ?? [];
  const out: string[] = [];
  for (const ext of exts) {
    if (ext.extnID !== OID_CRL_DP) continue;
    const parsed = ext.parsedValue as
      | {
          distributionPoints?: {
            distributionPoint?: { type: number; value: unknown[] }[] | unknown[];
          }[];
        }
      | undefined;
    const dps = parsed?.distributionPoints ?? [];
    for (const dp of dps) {
      const dpField = dp.distributionPoint;
      if (!dpField) continue;
      // pkijs models distributionPoint as either an array of GeneralName or RelativeDistinguishedName
      const arr = dpField as unknown as Array<unknown>;
      for (const gn of arr) {
        const uri = extractUriFromGeneralName(gn);
        if (uri) {
          // Prefer http/https; skip ldap://
          if (/^https?:\/\//i.test(uri)) out.push(uri);
        }
      }
    }
  }
  return out;
}
