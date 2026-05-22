/**
 * certCheck.ts — standalone certificate validation (no PDF, no signing).
 *
 * Powers the "Validar Certificado" PWA page: the user uploads a .p12/.pfx,
 * the signer extracts the leaf + intermediates as DER, and this function
 * reports who the cert belongs to, who issued it, whether it chains to a
 * real (non-placeholder) ARCOTEL-accredited root, and its validity window.
 *
 * Mirrors FirmaEC 5.1.0's "Validar Certificado" tab. It reuses the same
 * internal `validatePath` engine used by the PDF verifier so the trust
 * decision is identical to a signature's chain check.
 */

import { issuerInfo, subjectInfo, toHex } from '@firma-ec/crypto-core';
import { type TrustRoot, getTrustRoots } from '@firma-ec/tsl-ec';
import { fromBER } from 'asn1js';
import { Certificate } from 'pkijs';
import { validatePath } from './pathValidation';

export interface CertCheckResult {
  subjectCN: string;
  issuerCN: string;
  serialHex: string;
  notBefore: string; // ISO string
  notAfter: string; // ISO string
  validityStatus: 'valid' | 'expired' | 'not_yet_valid';
  /** Chains to a real (non-placeholder) ARCOTEL-accredited root. */
  trusted: boolean;
  matchedAceSlug?: string;
  matchedAceOrg?: string;
  warnings: string[];
}

export interface CertCheckOptions {
  /** Override the TSL roots; default fetched from @firma-ec/tsl-ec. */
  trustRoots?: TrustRoot[] | undefined;
  /** Reference time for validity + chain checks; defaults to now. */
  atTime?: Date | undefined;
}

/** Decode a DER-encoded X.509 certificate into a pkijs Certificate. */
function derToCert(der: Uint8Array): Certificate {
  const asn = fromBER(
    der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer,
  );
  if (asn.offset === -1) throw new Error('DER ASN.1 decode failed');
  return new Certificate({ schema: asn.result });
}

/**
 * Validate a single certificate (leaf) against the ARCOTEL TSL-EC roots.
 *
 * @param certDer          DER bytes of the leaf certificate.
 * @param intermediatesDer DER bytes of any intermediate CA certs.
 * @param opts             trustRoots / atTime overrides (for deterministic tests).
 */
export async function checkCertificate(
  certDer: Uint8Array,
  intermediatesDer: Uint8Array[],
  opts: CertCheckOptions = {},
): Promise<CertCheckResult> {
  const atTime = opts.atTime ?? new Date();
  const cert = derToCert(certDer);
  const intermediates = intermediatesDer.map(derToCert);
  const roots = opts.trustRoots ?? (await getTrustRoots());

  const path = await validatePath(cert, intermediates, roots, atTime);

  const subj = subjectInfo(cert);
  const iss = issuerInfo(cert);

  const notBefore = cert.notBefore.value;
  const notAfter = cert.notAfter.value;

  let validityStatus: CertCheckResult['validityStatus'];
  if (atTime < notBefore) validityStatus = 'not_yet_valid';
  else if (atTime > notAfter) validityStatus = 'expired';
  else validityStatus = 'valid';

  const result: CertCheckResult = {
    subjectCN: subj.cn ?? '',
    issuerCN: iss.cn ?? '',
    serialHex: toHex(new Uint8Array(cert.serialNumber.valueBlock.valueHex as ArrayBuffer)),
    notBefore: notBefore.toISOString(),
    notAfter: notAfter.toISOString(),
    validityStatus,
    trusted: path.success,
    warnings: [...path.warnings],
  };

  // Conditional spreads for exactOptionalPropertyTypes
  if (path.matchedRoot?.slug !== undefined) result.matchedAceSlug = path.matchedRoot.slug;
  if (path.matchedRoot?.orgName !== undefined) result.matchedAceOrg = path.matchedRoot.orgName;

  return result;
}
