/**
 * F7 LTV data collection for the signer.
 *
 * Orchestrates the OCSP-first / CRL-fallback cascade per spec §5.2:
 *
 *   for each cert in [signerCert, ...intermediates, tsaCert]:
 *     1. fetchOcsp(cert, issuer)  (live or cached)
 *     2. status === 'revoked'  → bubble up (caller throws certificate_revoked)
 *     3. fetch failed          → fetchCrl(cert, issuer)
 *     4. CRL failed too        → record warning, continue
 *
 * Returns the aggregate `DssData` ready to be passed to `appendDss`.
 *
 * Browser-compatible. No node:* imports.
 */

import { fetchOcsp, fetchCrl, isCertRevoked } from '@firma-ec/ltv-validation';
import type {
  ParsedCert,
  OcspResult,
  CrlResult,
  OcspCache,
  CrlCache,
} from '@firma-ec/ltv-validation';
import type { DssData, VriEntry } from '@firma-ec/dss-pdf';
import type { SignerCert } from './types.js';

export interface CollectLtvOpts {
  /** Signer cert (will be checked for revocation). */
  signerCert: SignerCert;
  /** Intermediate certs (signer issuer + roots). */
  intermediates: SignerCert[];
  /** TSA cert when timestamp succeeded (also LTV-checked). */
  tsaCert?: SignerCert | undefined;
  /** Per-request fetch timeout. */
  timeoutMs?: number;
  /** Override OCSP URL (else discovered via AIA). */
  ocspUrl?: string;
  /** Override CRL URL (else discovered via CRLDistributionPoints). */
  crlUrl?: string;
  /** Process-wide caches (optional). */
  ocspCache?: OcspCache;
  crlCache?: CrlCache;
  /** Signature `/Contents` bytes (raw DER of the PKCS#7) — used to compute VRI key. */
  signatureContents: Uint8Array;
}

export interface CollectLtvResult {
  /** Aggregate DSS data layer ready for appendDss. */
  data: DssData;
  /** True when any cert in the chain came back `revoked`. */
  revoked: false | { cn: string };
  /** Warnings collected (network errors, no_aia, etc). */
  warnings: Array<{ code: string; detail?: string }>;
}

/**
 * Convert SignerCert → ParsedCert. They are structurally compatible apart from
 * the extra `serialHex` field on SignerCert which ltv-validation doesn't need.
 */
function toParsedCert(c: SignerCert): ParsedCert {
  return {
    subjectCN: c.subjectCN || null,
    issuerCN: c.issuerCN || null,
    der: c.der,
    notBefore: c.notBefore,
    notAfter: c.notAfter,
  };
}

/**
 * Uppercase hex of SHA-1(`signatureContents`). Used as the /VRI key per ETSI
 * EN 319 142-1 §5.4 and Adobe Reader conventions.
 */
async function computeVriKey(signatureContents: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-1',
    signatureContents.buffer.slice(
      signatureContents.byteOffset,
      signatureContents.byteOffset + signatureContents.byteLength,
    ) as ArrayBuffer,
  );
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, '0').toUpperCase();
  return hex;
}

/**
 * Try to find the issuer of `subject` within `pool`. Returns null when no
 * candidate matches by `issuerCN === subject.subjectCN`. This is a CN-only
 * match (not SKI/AKI) — sufficient for ARCOTEL ECI Ecuador's chain in
 * practice, but documented as a caveat (spec §10).
 */
function findIssuer(subject: ParsedCert, pool: ParsedCert[]): ParsedCert | null {
  if (!subject.issuerCN) return null;
  for (const candidate of pool) {
    if (candidate.subjectCN === subject.issuerCN) return candidate;
  }
  return null;
}

/**
 * Try OCSP first for `cert`. On revoked → return revoked. On any other failure
 * → fall back to CRL. Returns ok/revoked/errors aggregate.
 */
async function checkOneCert(
  cert: ParsedCert,
  issuer: ParsedCert | null,
  opts: {
    timeoutMs: number;
    ocspUrl?: string | undefined;
    crlUrl?: string | undefined;
    ocspCache?: OcspCache | undefined;
    crlCache?: CrlCache | undefined;
  },
): Promise<{
  ocsp?: OcspResult;
  crl?: CrlResult;
  revoked: boolean;
  warnings: Array<{ code: string; detail?: string }>;
}> {
  const warnings: Array<{ code: string; detail?: string }> = [];
  // OCSP requires an issuer for the CertID hash.
  if (issuer) {
    const ocspRes = await fetchOcsp(cert, issuer, {
      timeoutMs: opts.timeoutMs,
      ...(opts.ocspUrl ? { url: opts.ocspUrl } : {}),
      ...(opts.ocspCache ? { cache: opts.ocspCache } : {}),
    });
    if (ocspRes.ok) {
      if (ocspRes.status === 'revoked') {
        return { ocsp: ocspRes, revoked: true, warnings };
      }
      if (ocspRes.status === 'good') {
        return { ocsp: ocspRes, revoked: false, warnings };
      }
      // 'unknown' → fall through to CRL.
      warnings.push({ code: 'ocsp_unknown', detail: `responder returned unknown for ${cert.subjectCN ?? '?'}` });
    } else {
      warnings.push({ code: `ocsp_${ocspRes.reason}`, ...(ocspRes.detail !== undefined ? { detail: ocspRes.detail } : {}) });
    }
  } else {
    warnings.push({ code: 'ocsp_no_issuer', detail: `no issuer in pool for ${cert.subjectCN ?? '?'}` });
  }

  // CRL fallback.
  const crlRes = await fetchCrl(cert, {
    timeoutMs: opts.timeoutMs,
    ...(opts.crlUrl ? { url: opts.crlUrl } : {}),
    ...(issuer ? { issuerCert: issuer } : {}),
    ...(opts.crlCache ? { cache: opts.crlCache } : {}),
  });
  if (crlRes.ok) {
    const revCheck = isCertRevoked(cert, crlRes.crl);
    if (revCheck.revoked) {
      return { crl: crlRes, revoked: true, warnings };
    }
    return { crl: crlRes, revoked: false, warnings };
  }
  warnings.push({ code: `crl_${crlRes.reason}`, ...(crlRes.detail !== undefined ? { detail: crlRes.detail } : {}) });
  return { revoked: false, warnings };
}

/**
 * Collect OCSP/CRL data for the full cert chain. Output is ready to be passed
 * to `@firma-ec/dss-pdf.appendDss`.
 *
 * On `revoked` for any cert, returns immediately with `revoked: { cn }` so the
 * caller can throw `certificate_revoked`.
 */
export async function collectLtvData(opts: CollectLtvOpts): Promise<CollectLtvResult> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const signer = toParsedCert(opts.signerCert);
  const intermediates = opts.intermediates.map(toParsedCert);
  const tsaCert = opts.tsaCert ? toParsedCert(opts.tsaCert) : null;

  // Pool of certs in which to look for issuers.
  const pool = [signer, ...intermediates];
  if (tsaCert) pool.push(tsaCert);

  // Certs we need revocation info for. Don't bother for self-signed roots —
  // they sign themselves so OCSP/CRL on them adds no value (and ARCOTEL roots
  // typically lack AIA OCSP anyway).
  const toCheck: ParsedCert[] = [signer, ...intermediates];
  if (tsaCert) toCheck.push(tsaCert);

  const certs: Uint8Array[] = [];
  const ocsps: Uint8Array[] = [];
  const crls: Uint8Array[] = [];
  const seenCerts = new Set<string>(); // dedupe by SHA-256(der)
  const certIndices: number[] = [];
  const ocspIndices: number[] = [];
  const crlIndices: number[] = [];
  const allWarnings: Array<{ code: string; detail?: string }> = [];

  // Add every cert to the global /Certs array (dedup by DER hash).
  for (const c of pool) {
    const hash = await sha256Hex(c.der);
    if (seenCerts.has(hash)) continue;
    seenCerts.add(hash);
    certIndices.push(certs.length);
    certs.push(c.der);
  }

  let revoked: false | { cn: string } = false;

  for (let idx = 0; idx < toCheck.length; idx++) {
    const cert = toCheck[idx]!;
    // Skip self-signed certs that are NOT the signing cert. The signing cert
    // must always be checked because the user might be holding a freshly
    // revoked credential. Self-signed intermediates/roots are skipped because
    // OCSP/CRL on a self-signed root adds no security value — the root signs
    // itself, so revocation must come out of band (TSL/CRL distributor).
    const isSelfSigned = cert.issuerCN && cert.subjectCN && cert.issuerCN === cert.subjectCN;
    if (isSelfSigned && cert !== signer) {
      continue;
    }
    const issuer = findIssuer(cert, pool);
    const res = await checkOneCert(cert, issuer, {
      timeoutMs,
      ocspUrl: opts.ocspUrl,
      crlUrl: opts.crlUrl,
      ocspCache: opts.ocspCache,
      crlCache: opts.crlCache,
    });
    allWarnings.push(...res.warnings);
    if (res.revoked) {
      revoked = { cn: cert.subjectCN ?? 'unknown' };
      break;
    }
    if (res.ocsp) {
      ocspIndices.push(ocsps.length);
      ocsps.push(res.ocsp.responseDer);
    }
    if (res.crl) {
      crlIndices.push(crls.length);
      crls.push(res.crl.crlDer);
    }
  }

  const vri: Record<string, VriEntry> = {};
  if (!revoked && (ocsps.length > 0 || crls.length > 0)) {
    const vriKey = await computeVriKey(opts.signatureContents);
    const entry: VriEntry = {
      certIndices: certIndices.slice(),
      ocspIndices: ocspIndices.slice(),
      crlIndices: crlIndices.slice(),
    };
    vri[vriKey] = entry;
  }

  return {
    data: { certs, ocsps, crls, vri },
    revoked,
    warnings: allWarnings,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  const arr = new Uint8Array(buf);
  let h = '';
  for (let i = 0; i < arr.length; i++) h += arr[i]!.toString(16).padStart(2, '0');
  return h;
}

/**
 * Extract the raw `/Contents` bytes (DER of the PKCS#7 / CMS SignedData) from
 * a signed PDF. Looks for the LAST /Sig dict whose /SubFilter is
 * `ETSI.CAdES.detached` — that's the signature we just produced.
 *
 * Returns null when no such signature is present.
 */
export function extractSignatureContents(pdfBytes: Uint8Array): Uint8Array | null {
  const text = new TextDecoder('latin1').decode(pdfBytes);
  // Find every /Sig dict header by scanning for `/Type /Sig` (or just the
  // /SubFilter /ETSI.CAdES.detached marker since /Type /Sig is implicit in
  // some emitters). We use SubFilter as the discriminator.
  const subFilterMarker = '/SubFilter /ETSI.CAdES.detached';
  let lastSubFilter = -1;
  let from = 0;
  while (true) {
    const idx = text.indexOf(subFilterMarker, from);
    if (idx < 0) break;
    lastSubFilter = idx;
    from = idx + subFilterMarker.length;
  }
  if (lastSubFilter < 0) return null;
  // Find the /Contents <...> after this marker.
  const ctIdx = text.indexOf('/Contents', lastSubFilter);
  if (ctIdx < 0) return null;
  const ltIdx = text.indexOf('<', ctIdx);
  const gtIdx = text.indexOf('>', ltIdx);
  if (ltIdx < 0 || gtIdx < 0) return null;
  const hex = text.substring(ltIdx + 1, gtIdx).replace(/[\s\n\r]/g, '');
  // Strip trailing zero pad.
  const trimmed = hex.replace(/0+$/, '');
  const finalHex = trimmed.length % 2 === 0 ? trimmed : trimmed + '0';
  const out = new Uint8Array(Math.floor(finalHex.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(finalHex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}
