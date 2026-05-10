/**
 * CRL revocation check.
 *
 * Searches `crl.revokedCertificates[]` for a serialNumber match against the
 * subject cert's serial. Returns `{ revoked: false }` when not found.
 *
 * RFC 5280 §5.3.1 reason codes (CRLReason):
 *   0=unspecified, 1=keyCompromise, 2=cACompromise, 3=affiliationChanged,
 *   4=superseded, 5=cessationOfOperation, 6=certificateHold, 8=removeFromCRL,
 *   9=privilegeWithdrawn, 10=aACompromise.
 */

import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import type { ParsedCert } from '../types';

const REASON_NAMES: Record<number, string> = {
  0: 'unspecified',
  1: 'keyCompromise',
  2: 'cACompromise',
  3: 'affiliationChanged',
  4: 'superseded',
  5: 'cessationOfOperation',
  6: 'certificateHold',
  8: 'removeFromCRL',
  9: 'privilegeWithdrawn',
  10: 'aACompromise',
};

const OID_REASON_CODE = '2.5.29.21';

function toAB(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function bufToHexCanonical(buf: ArrayBuffer): string {
  // Strip leading zero bytes for canonical compare (some libs prefix INTEGER with 0x00)
  const u = new Uint8Array(buf);
  let i = 0;
  while (i < u.length - 1 && u[i] === 0) i++;
  let out = '';
  for (let j = i; j < u.length; j++) {
    const b = u[j] ?? 0;
    out += b.toString(16).padStart(2, '0');
  }
  return out.toLowerCase();
}

function getSerialHex(cert: ParsedCert): string {
  const asn = asn1js.fromBER(toAB(cert.der));
  if (asn.offset === -1) throw new Error('cert ASN.1 decode failed');
  const c = new pkijs.Certificate({ schema: asn.result });
  const sn = (c.serialNumber.valueBlock as { valueHex: ArrayBuffer }).valueHex;
  return bufToHexCanonical(sn);
}

export interface CrlRevocationCheck {
  revoked: boolean;
  revokedAt?: Date;
  reason?: string;
}

/**
 * Check whether `cert` appears in `crl.revokedCertificates`.
 *
 * @param cert subject cert under question.
 * @param crl parsed CertificateRevocationList (from `fetchCrl(...).crl`).
 */
export function isCertRevoked(cert: ParsedCert, crl: pkijs.CertificateRevocationList): CrlRevocationCheck {
  const targetSerial = getSerialHex(cert);
  const list = crl.revokedCertificates ?? [];
  for (const entry of list) {
    const sn = (entry.userCertificate.valueBlock as { valueHex: ArrayBuffer }).valueHex;
    const entrySerial = bufToHexCanonical(sn);
    if (entrySerial !== targetSerial) continue;
    const result: CrlRevocationCheck = {
      revoked: true,
    };
    const revAt = entry.revocationDate?.value as Date | undefined;
    if (revAt) result.revokedAt = revAt;
    // Reason code from CRL entry extensions
    const exts = entry.crlEntryExtensions?.extensions ?? [];
    for (const ext of exts) {
      if (ext.extnID !== OID_REASON_CODE) continue;
      const parsed = ext.parsedValue as { valueBlock?: { valueDec?: number } } | undefined;
      const code = parsed?.valueBlock?.valueDec;
      if (typeof code === 'number') {
        result.reason = REASON_NAMES[code] ?? `code_${code}`;
      }
    }
    return result;
  }
  return { revoked: false };
}
