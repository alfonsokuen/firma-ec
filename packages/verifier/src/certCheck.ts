/**
 * certCheck.ts — standalone certificate validation (no PDF, no signing).
 *
 * Powers the "Validar Certificado" PWA page: the user uploads a .p12/.pfx,
 * the signer extracts the leaf + intermediates as DER, and this function
 * reports who the cert belongs to, who issued it, whether it chains to a
 * real (non-placeholder) ARCOTEL-accredited root, its validity window, and
 * — when `checkRevocation` is set — its live OCSP/CRL revocation status.
 *
 * Mirrors FirmaEC 5.1.0's "Validar Certificado" tab (titular split into
 * nombres/apellidos + cédula, plus Expirado / Revocado states). It reuses the
 * same internal `validatePath` engine used by the PDF verifier so the trust
 * decision is identical to a signature's chain check, and the same
 * `@firma-ec/ltv-validation` OCSP→CRL cascade the signer uses for LTV.
 */

import { issuerInfo, subjectInfo, toHex } from '@firma-ec/crypto-core';
import {
  ARCOTEL_PROXY_MAP,
  type ParsedCert,
  type ProxyMap,
  fetchCrl,
  fetchOcsp,
  isCertRevoked,
} from '@firma-ec/ltv-validation';
import { type TrustRoot, getTrustRoots } from '@firma-ec/tsl-ec';
import { fromBER } from 'asn1js';
import { Certificate } from 'pkijs';
import { validatePath } from './pathValidation';

/** Live revocation outcome. `unchecked` means no network check was requested. */
export type CertRevocationStatus = 'good' | 'revoked' | 'unknown' | 'unchecked';

export interface CertCheckResult {
  subjectCN: string;
  issuerCN: string;
  /** Subject serialNumber RDN (OID 2.5.4.5) — the cédula/RUC in EC certs. */
  cedula?: string;
  /** Given name (OID 2.5.4.42) — "nombres". */
  givenName?: string;
  /** Surname (OID 2.5.4.4) — "apellidos". */
  surname?: string;
  serialHex: string;
  notBefore: string; // ISO string
  notAfter: string; // ISO string
  validityStatus: 'valid' | 'expired' | 'not_yet_valid';
  /** Chains to a real (non-placeholder) ARCOTEL-accredited root. */
  trusted: boolean;
  matchedAceSlug?: string;
  matchedAceOrg?: string;
  /** Live revocation status. 'unchecked' when `checkRevocation` was off. */
  revocationStatus: CertRevocationStatus;
  /** Mechanism that produced the determination. */
  revocationVia?: 'ocsp' | 'crl';
  /** ISO date the cert was revoked (only when status === 'revoked'). */
  revokedAt?: string;
  /** Diagnostic detail when status is 'unknown' (e.g. 'no_aia', 'network'). */
  revocationDetail?: string;
  warnings: string[];
}

export interface CertCheckOptions {
  /** Override the TSL roots; default fetched from @firma-ec/tsl-ec. */
  trustRoots?: TrustRoot[] | undefined;
  /** Reference time for validity + chain checks; defaults to now. */
  atTime?: Date | undefined;
  /** When true, perform a live OCSP→CRL revocation check against ARCOTEL. */
  checkRevocation?: boolean | undefined;
  /** Same-origin proxy map for OCSP/CRL upstreams. Defaults to
   *  ARCOTEL_PROXY_MAP. Pass `null` to disable proxying (direct fetch). */
  proxyMap?: ProxyMap | null | undefined;
  /** Per-request network timeout (ms). Default 8000. */
  revocationTimeoutMs?: number | undefined;
  /** fetch implementation override (for deterministic tests). */
  fetchImpl?: typeof globalThis.fetch | undefined;
}

/** Decode a DER-encoded X.509 certificate into a pkijs Certificate. */
function derToCert(der: Uint8Array): Certificate {
  const asn = fromBER(
    der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer,
  );
  if (asn.offset === -1) throw new Error('DER ASN.1 decode failed');
  return new Certificate({ schema: asn.result });
}

/** Build the minimal ParsedCert the LTV layer needs from a parsed cert + its DER. */
function toLtvParsedCert(cert: Certificate, der: Uint8Array): ParsedCert {
  return {
    subjectCN: subjectInfo(cert).cn ?? null,
    issuerCN: issuerInfo(cert).cn ?? null,
    der,
    notBefore: cert.notBefore.value,
    notAfter: cert.notAfter.value,
  };
}

interface RevocationOutcome {
  status: CertRevocationStatus;
  via?: 'ocsp' | 'crl';
  revokedAt?: string;
  detail?: string;
}

/**
 * Live OCSP-first / CRL-fallback revocation check for the leaf certificate.
 *
 * Mirrors the signer's `collectLtvData` cascade (spec §5.2): OCSP `revoked` /
 * `good` is authoritative; OCSP `unknown` or any transport failure falls back
 * to a CRL lookup; if neither yields a determination the status is `unknown`
 * (e.g. offline, or the cert exposes no AIA/CDP). Never throws.
 */
async function checkRevocationLive(
  leaf: ParsedCert,
  issuer: ParsedCert | null,
  opts: CertCheckOptions,
): Promise<RevocationOutcome> {
  const proxyMap = opts.proxyMap === null ? undefined : (opts.proxyMap ?? ARCOTEL_PROXY_MAP);
  const timeoutMs = opts.revocationTimeoutMs ?? 8000;
  const fetchImpl = opts.fetchImpl;

  let lastDetail = 'no_issuer';

  // OCSP requires the issuer cert for the CertID hash.
  if (issuer) {
    const ocsp = await fetchOcsp(leaf, issuer, {
      timeoutMs,
      ...(proxyMap ? { proxyMap } : {}),
      ...(fetchImpl ? { fetchImpl } : {}),
    });
    if (ocsp.ok) {
      if (ocsp.status === 'revoked') {
        return {
          status: 'revoked',
          via: 'ocsp',
          ...(ocsp.revokedAt ? { revokedAt: ocsp.revokedAt.toISOString() } : {}),
        };
      }
      if (ocsp.status === 'good') return { status: 'good', via: 'ocsp' };
      lastDetail = 'ocsp_unknown';
    } else {
      lastDetail = `ocsp_${ocsp.reason}`;
    }
  }

  // CRL fallback.
  const crl = await fetchCrl(leaf, {
    timeoutMs,
    ...(issuer ? { issuerCert: issuer } : {}),
    ...(proxyMap ? { proxyMap } : {}),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  if (crl.ok) {
    const rev = isCertRevoked(leaf, crl.crl);
    if (rev.revoked) {
      return {
        status: 'revoked',
        via: 'crl',
        ...(rev.revokedAt ? { revokedAt: rev.revokedAt.toISOString() } : {}),
        ...(rev.reason ? { detail: rev.reason } : {}),
      };
    }
    return { status: 'good', via: 'crl' };
  }

  return { status: 'unknown', detail: issuer ? `crl_${crl.reason}` : lastDetail };
}

/**
 * Validate a single certificate (leaf) against the ARCOTEL TSL-EC roots.
 *
 * @param certDer          DER bytes of the leaf certificate.
 * @param intermediatesDer DER bytes of any intermediate CA certs.
 * @param opts             trustRoots / atTime / revocation overrides.
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

  const warnings = [...path.warnings];

  // Live revocation (OCSP→CRL) when requested.
  let revocation: RevocationOutcome = { status: 'unchecked' };
  if (opts.checkRevocation) {
    const leafParsed = toLtvParsedCert(cert, certDer);
    const issuerParsed =
      intermediates
        .map((c, i) => toLtvParsedCert(c, intermediatesDer[i]!))
        .find((c) => c.subjectCN !== null && c.subjectCN === leafParsed.issuerCN) ?? null;
    revocation = await checkRevocationLive(leafParsed, issuerParsed, opts);
    if (revocation.status === 'revoked') warnings.push('cert_revoked');
    else if (revocation.status === 'unknown') {
      warnings.push(`revocation_unknown: ${revocation.detail ?? 'unverifiable'}`);
    }
  }

  const result: CertCheckResult = {
    subjectCN: subj.cn ?? '',
    issuerCN: iss.cn ?? '',
    serialHex: toHex(new Uint8Array(cert.serialNumber.valueBlock.valueHex as ArrayBuffer)),
    notBefore: notBefore.toISOString(),
    notAfter: notAfter.toISOString(),
    validityStatus,
    trusted: path.success,
    revocationStatus: revocation.status,
    warnings,
  };

  // Conditional spreads for exactOptionalPropertyTypes
  if (subj.serialNumber !== undefined) result.cedula = subj.serialNumber;
  if (subj.raw['GN'] !== undefined) result.givenName = subj.raw['GN'];
  if (subj.raw['SN'] !== undefined) result.surname = subj.raw['SN'];
  if (path.matchedRoot?.slug !== undefined) result.matchedAceSlug = path.matchedRoot.slug;
  if (path.matchedRoot?.orgName !== undefined) result.matchedAceOrg = path.matchedRoot.orgName;
  if (revocation.via !== undefined) result.revocationVia = revocation.via;
  if (revocation.revokedAt !== undefined) result.revokedAt = revocation.revokedAt;
  if (revocation.detail !== undefined) result.revocationDetail = revocation.detail;

  return result;
}
