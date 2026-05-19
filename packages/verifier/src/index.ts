import { digest, issuerInfo, subjectInfo, toHex } from '@firma-ec/crypto-core';
import { getTrustRoots } from '@firma-ec/tsl-ec';
import { parseCms } from './cms';
import { extractDss } from './dss';
import { VerificationError } from './errors';
import { checkDocumentIntegrity, verifySignatureValue } from './integrity';
import { verifyLtv } from './ltv';
import { checkOcsp } from './ocsp';
import { validatePath } from './pathValidation';
import { type SignedRange, findAllSignatures, findSignature } from './pdf';
import type { Status, VerificationResult } from './result';
import { verifyTimestamp } from './timestamp';

export type {
  VerificationResult,
  Status,
  SignerSummary,
  SignatureMeta,
  OcspStatus,
  IntegrityCheck,
  VerificationWarning,
  TimestampSummary,
  LtvSummary,
} from './result';
export type { TimestampVerification, TimestampBadge, TimestampReason } from './timestamp';
export type { LtvProfile, DocumentTimestampSummary } from './ltv';
export { verifyTimestamp } from './timestamp';
export { extractDss } from './dss';
export { verifyLtv } from './ltv';
export { VerificationError } from './errors';

// Bump on each release (kept hardcoded — JSON imports require resolveJsonModule
// + downstream tsconfig coupling we'd rather avoid in this package).
export const ENGINE_VERSION = '0.7.6';

/**
 * Dedupe a certificate list by DER fingerprint. Used to merge intermediates
 * harvested from multiple signatures in the same PDF before chain validation.
 */
function mergeCertsDedup(certs: import('pkijs').Certificate[]): import('pkijs').Certificate[] {
  const seen = new Set<string>();
  const out: import('pkijs').Certificate[] = [];
  for (const c of certs) {
    try {
      const der = new Uint8Array(c.toSchema().toBER(false));
      let key = '';
      for (let i = 0; i < der.length; i += 1) key += der[i]!.toString(16).padStart(2, '0');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    } catch {
      // Cert that can't be DER-encoded shouldn't be in the chain anyway — skip.
    }
  }
  return out;
}

export interface VerifyOptions {
  /** Whether to query OCSP responders. Default true; set false for offline mode. */
  fetchOcsp?: boolean | undefined;
  /** Override the TSL roots; default fetched from @firma-ec/tsl-ec. */
  trustRoots?: Awaited<ReturnType<typeof getTrustRoots>> | undefined;
}

/**
 * Verify a single PAdES signature against the given PDF bytes. Internal helper
 * used by both `verifyPdf` (first/only signature, back-compat) and
 * `verifyAllSignatures` (enumerates every signature for multi-firma PDFs).
 *
 * Accepts `sig` already located by `findSignature` / `findAllSignatures` so
 * the caller can iterate without re-parsing the PDF once per signature.
 */
async function verifyOneSignature(
  pdfBytes: Uint8Array,
  sig: SignedRange,
  opts: VerifyOptions,
  roots: Awaited<ReturnType<typeof getTrustRoots>>,
  verifiedAt: string,
  sharedIntermediates: import('pkijs').Certificate[] = [],
  /** True iff this is the latest signature in the PDF. Sigs before the latest
   * always have "bytes after them" because subsequent sigs were appended via
   * legitimate PAdES incremental update — those should NOT raise
   * `incremental_updates`. */
  isLatestSignature = true,
  /** v0.7.29 — true when the bytes appended after this signature correspond
   * to a PAdES B-LTA document timestamp (legitimate /SubFilter /ETSI.RFC3161
   * wrap, not tampering). When set, suppresses the `incremental_updates`
   * warning even if `sig.hasIncrementalUpdates` is true. */
  appendedBytesAreDocTimeStamp = false,
): Promise<VerificationResult> {
  const warnings: VerificationResult['warnings'] = [];
  try {
    const cms = await parseCms(sig.contents);

    // Integrity: document hash + signature value
    const docCheck = await checkDocumentIntegrity(
      pdfBytes,
      sig.byteRange,
      cms.digestAlgoOid,
      cms.signedMessageDigest,
    );
    const sigValid = await verifySignatureValue(
      cms.signerCert,
      cms.signatureAlgoOid,
      cms.digestAlgoOid,
      cms.signedAttrsDer,
      cms.signatureValue,
    );

    // F6 — RFC 3161 timestamp verification. Best-effort: never degrades the
    // outer signature validity (silver only adds a warning; spec §6.2).
    const tsaResult = await verifyTimestamp(cms.timestampToken, cms.signatureValue);

    // F7 — DSS extraction + LTV summary. Best-effort: never degrades outer
    // signature validity (LT-as-warning; spec §6.4).
    const dssOutcome = extractDss(pdfBytes);
    if (dssOutcome.error) {
      warnings.push({ code: 'dss_malformed', message: dssOutcome.error });
    }

    // Path validation. Multi-sig PDFs (e.g. iCert-EC judicial documents) may
    // have one signer that didn't embed the chain in its CMS while a sibling
    // signature did. Merge cms.intermediates with sharedIntermediates harvested
    // from every other signature in the same PDF, deduped by DER fingerprint.
    const mergedIntermediates = mergeCertsDedup([...cms.intermediates, ...sharedIntermediates]);
    const path = await validatePath(
      cms.signerCert,
      mergedIntermediates,
      roots,
      cms.signingTime ?? new Date(),
    );

    // Detect "trust chain inconclusive due to placeholder TSL" — this is NOT a
    // crypto failure, just a missing trust anchor. We must NOT degrade to
    // 'invalid' in this case: hash + signature are sound, but the trust list
    // hasn't published real ARCOTEL roots yet (F2 / pre-v0.2.0 state). The PWA
    // shows a DEMO banner when this warning code appears.
    //
    // Heuristic: if all TSL roots are placeholders, no real chain can succeed
    // even for a perfectly signed ECI/Security Data PDF. Treat that as
    // 'warning' with code TRUST_PLACEHOLDER (consumed by Verificar.svelte).
    //
    // F6.7 (2026-05-10): granular state — some real PEMs landed (Eclipsoft,
    // Uanataca). When path.success===false but a real root for the signer's
    // issuer simply isn't in the TSL yet, we still flag as provisional but
    // with a softer message ("partial demo: N de M ACEs faltan").
    //
    // 2026-05-14: ACEs flagged isDefunct (ARCOTEL-listed but no operational
    // public presence) are excluded from the active denominator so the banner
    // reflects only currently-issuing CAs.
    const activeRoots = roots.filter((r) => !r.isDefunct && !r.isParallelAnchor);
    const placeholderCount = activeRoots.filter((r) => r.isPlaceholder).length;
    const allRootsPlaceholder = activeRoots.length > 0 && placeholderCount === activeRoots.length;
    const someRootsPlaceholder =
      activeRoots.length > 0 && placeholderCount > 0 && placeholderCount < activeRoots.length;
    const trustInconclusive = !path.success && (allRootsPlaceholder || someRootsPlaceholder);

    // OCSP (optional). Per ETSI EN 319 142-1, revocation status at verification
    // time is only REQUIRED for B-LT / B-LTA profiles (which embed it in DSS).
    // For B-B / B-T the spec leaves revocation to the validation policy — and
    // FirmaEC desktop (the reference implementation in EC) does not fetch OCSP
    // online for B-B. We mirror that behaviour: only attempt online OCSP when
    // a TSA timestamp is present (signature is at least B-T). This eliminates
    // the noisy `ocsp_unavailable` warning on B-B PDFs caused by responders
    // without CORS — a transport failure is not evidence of revocation.
    let ocsp: VerificationResult['ocsp'] = { status: 'not_checked', source: 'none' };
    if (opts.fetchOcsp !== false && path.success && path.matchedRoot && tsaResult.present) {
      const issuerCert = path.chain[1]; // signer's issuer = next cert in chain
      if (issuerCert) {
        ocsp = await checkOcsp({
          signerCert: cms.signerCert,
          issuerCert,
          acSlug: path.matchedRoot.slug,
        });
      }
    }

    // Compute final status. Crypto failures (hash mismatch, sig invalid,
    // OCSP-revoked) are hard 'invalid'. Real chain failures (cert NOT covered
    // by usable real roots) are also 'invalid'. But chain failures caused
    // SOLELY by all roots being placeholders are 'warning' — the PWA renders
    // a DEMO banner explaining the trust anchor is provisional.
    let status: Status;
    if (!docCheck.matches) status = 'invalid';
    else if (!sigValid) status = 'invalid';
    else if (!path.success && !trustInconclusive) {
      status = 'invalid';
      warnings.push({
        code: 'untrusted_root',
        message:
          'El certificado del firmante no encadena con ninguna ACE acreditada por ARCOTEL en la TSL-EC. La firma es criptográficamente correcta pero no proviene de un emisor reconocido en Ecuador.',
      });
    } else if (ocsp?.status === 'revoked') status = 'invalid';
    else if (trustInconclusive) {
      status = 'warning';
      if (allRootsPlaceholder) {
        warnings.push({
          code: 'TRUST_PLACEHOLDER',
          message:
            'ARCOTEL TSL roots are placeholders; cryptographic checks passed but the trust chain is provisional (not yet binding).',
        });
      } else {
        const realCount = activeRoots.length - placeholderCount;
        warnings.push({
          code: 'TRUST_PARTIAL',
          message: `Trust chain not yet established: ${realCount}/${activeRoots.length} ACEs ARCOTEL activas tienen raíz real; ${placeholderCount} aún placeholder. Cryptographic checks passed.`,
        });
      }
    } else if (
      sig.hasIncrementalUpdates &&
      isLatestSignature &&
      !appendedBytesAreDocTimeStamp
    ) {
      // Only flag for the LATEST signature — in multi-sig PDFs the "bytes after"
      // earlier signatures are subsequent legitimate signatures (PAdES
      // incremental updates), not document tampering. v0.7.29: a PAdES B-LTA
      // document timestamp wrap appended after the user signature is also a
      // legitimate incremental update, not tampering.
      status = 'warning';
      warnings.push({
        code: 'incremental_updates',
        message: 'PDF has bytes appended after the signature; signature does not cover them.',
      });
    } else if (ocsp?.status === 'unknown') {
      // Only warn when the responder actually returned an ambiguous status.
      // 'not_checked' means we deliberately skipped (B-B profile or fetch
      // disabled) — not a finding worth surfacing.
      status = 'warning';
      warnings.push({
        code: 'ocsp_unavailable',
        message: 'OCSP responder did not return a definitive status for this certificate.',
      });
    } else {
      status = 'valid';
    }

    // Forward TSL diagnostic warnings (placeholder list, fingerprint mismatches).
    for (const w of path.warnings ?? []) warnings.push({ code: 'tsl_warning', message: w });

    // F6: surface a non-fatal warning when a token is present but didn't
    // verify (silver). Outer signature status is unchanged — the warning is
    // purely informational and drives PWA UI badge state.
    if (tsaResult.present && !tsaResult.valid) {
      warnings.push({
        code: 'timestamp_invalid',
        message: `RFC 3161 timestamp present but failed verification (${tsaResult.reason ?? 'unknown'}).`,
      });
    }

    // F7 — verifyLtv runs after path validation so we can pass the chain.
    // Always runs (even when DSS absent) to detect document timestamps.
    const ltvSummary = await verifyLtv(path.chain ?? [], dssOutcome.data, sig.contents, pdfBytes);
    for (const err of ltvSummary.errors) {
      warnings.push({ code: 'ltv_warning', message: err });
    }

    // Profile state machine: pick the highest profile achieved.
    // F6 baseline is B-T (timestamp valid) or B-B (no timestamp); F7 may
    // upgrade to B-LT (DSS material) or B-LTA (document timestamp + DSS).
    // Critical regression guard (rule §9): NEVER downgrade B-T when DSS
    // absent — the timestamp-derived profile floor stays B-T.
    const tsaProfile: 'B-T' | 'B-B' = tsaResult.present && tsaResult.valid ? 'B-T' : 'B-B';
    const ltvProfile = ltvSummary.profile;
    const profileRank: Record<typeof ltvProfile, number> = {
      'B-B': 0,
      'B-T': 1,
      'B-LT': 2,
      'B-LTA': 3,
    };
    const finalProfile: 'B-B' | 'B-T' | 'B-LT' | 'B-LTA' =
      profileRank[ltvProfile] > profileRank[tsaProfile] ? ltvProfile : tsaProfile;

    const subjFp = toHex(
      await digest('SHA-256', new Uint8Array(cms.signerCert.toSchema().toBER(false))),
    );

    const result: VerificationResult = {
      status,
      signer: {
        cert: {
          subject: subjectInfo(cms.signerCert),
          issuer: issuerInfo(cms.signerCert),
          serialNumberHex: toHex(
            new Uint8Array(cms.signerCert.serialNumber.valueBlock.valueHex as ArrayBuffer),
          ),
          validFrom: cms.signerCert.notBefore.value.toISOString(),
          validUntil: cms.signerCert.notAfter.value.toISOString(),
          fingerprintSha256: subjFp,
        },
      },
      signature: {
        // F6/F7: timestamp baseline + LTV upgrade. Highest tier wins.
        profile: finalProfile,
        digestAlgo: cms.digestAlgoOid,
        signatureAlgo: cms.signatureAlgoOid,
        timestamp: {
          present: tsaResult.present,
          valid: tsaResult.valid,
          badge: tsaResult.badge,
          ...(tsaResult.signingTime ? { signingTime: tsaResult.signingTime.toISOString() } : {}),
          ...(tsaResult.tsaIssuer ? { tsaIssuer: tsaResult.tsaIssuer } : {}),
          ...(tsaResult.reason ? { reason: tsaResult.reason } : {}),
        },
        ltv: ltvSummary,
      },
      ocsp,
      integrity: {
        digestMatches: docCheck.matches,
        hasIncrementalUpdates: sig.hasIncrementalUpdates,
        coveredBytes: sig.byteRange[1] + sig.byteRange[3],
        totalBytes: pdfBytes.length,
      },
      warnings,
      engineVersion: ENGINE_VERSION,
      verifiedAt,
    };

    // Conditional spreads for exactOptionalPropertyTypes
    if (path.matchedRoot?.slug !== undefined)
      result.signer!.matchedRootSlug = path.matchedRoot.slug;
    if (path.matchedRoot?.commonName !== undefined)
      result.signer!.matchedRootName = path.matchedRoot.commonName;
    if (cms.signingTime !== undefined)
      result.signature!.signingTime = cms.signingTime.toISOString();
    if (sig.reason !== undefined) result.signature!.reason = sig.reason;
    if (sig.location !== undefined) result.signature!.location = sig.location;
    if (sig.contactInfo !== undefined) result.signature!.contactInfo = sig.contactInfo;

    return result;
  } catch (e) {
    const code = e instanceof VerificationError ? e.code : 'unknown';
    return {
      status: 'invalid',
      warnings,
      engineVersion: ENGINE_VERSION,
      verifiedAt,
      error: `${code}: ${(e as Error).message}`,
    };
  }
}

/**
 * Verify the FIRST signature in the PDF (back-compat). For multi-firma PDFs
 * use {@link verifyAllSignatures} which returns every signature independently.
 */
export async function verifyPdf(
  pdfBytes: Uint8Array,
  opts: VerifyOptions = {},
): Promise<VerificationResult> {
  const verifiedAt = new Date().toISOString();
  try {
    const sig = await findSignature(pdfBytes);
    if (!sig) {
      return { status: 'no_signature', warnings: [], engineVersion: ENGINE_VERSION, verifiedAt };
    }
    const roots = opts.trustRoots ?? (await getTrustRoots());
    return verifyOneSignature(pdfBytes, sig, opts, roots, verifiedAt);
  } catch (e) {
    const code = e instanceof VerificationError ? e.code : 'unknown';
    return {
      status: 'invalid',
      warnings: [],
      engineVersion: ENGINE_VERSION,
      verifiedAt,
      error: `${code}: ${(e as Error).message}`,
    };
  }
}

/**
 * Aggregate verification result for a PDF containing N signatures (N >= 0).
 * Each entry in `signatures` is a full {@link VerificationResult} for one
 * signature, in document order (chronological signing order).
 *
 * `overallStatus` rules (worst-case across all signatures):
 *   - `no_signature`  → 0 signatures.
 *   - `invalid`       → at least one signature has status='invalid'.
 *   - `warning`       → no invalid, but at least one has status='warning'.
 *   - `valid`         → all signatures have status='valid'.
 */
export interface MultiVerificationResult {
  signatureCount: number;
  signatures: VerificationResult[];
  overallStatus: Status;
  engineVersion: string;
  verifiedAt: string;
}

/**
 * Verify EVERY PAdES signature in the PDF. Each signature is validated
 * independently (its own cert chain, OCSP, TSA, LTV) so a partially-valid
 * multi-firma PDF reports per-signature status.
 *
 * Use this in the UI when the PDF may have been signed by more than one
 * party. For single-sig PDFs the result equals `[verifyPdf()]`.
 */
export async function verifyAllSignatures(
  pdfBytes: Uint8Array,
  opts: VerifyOptions = {},
): Promise<MultiVerificationResult> {
  const verifiedAt = new Date().toISOString();
  try {
    const allSigs = await findAllSignatures(pdfBytes);
    // v0.7.29 — PAdES B-LTA document timestamps (/SubFilter /ETSI.RFC3161)
    // are NOT user signatures: they're RFC 3161 TimeStampTokens wrapping the
    // prior /Contents as an incremental update. The verifier already surfaces
    // them via the per-signer `signature.timestamp` + LTV scan (`verifyLtv`),
    // so they must not appear as a separate "Firma inválida" entry nor pollute
    // the intermediate pool (freetsa/ECC chains were causing the real signer
    // to lose its matched ARCOTEL root). Filter them out of the user-signature
    // list before pooling + per-sig verification.
    const sigs = allSigs.filter((s) => s.subFilter !== 'ETSI.RFC3161');
    if (sigs.length === 0) {
      return {
        signatureCount: 0,
        signatures: [],
        overallStatus: 'no_signature',
        engineVersion: ENGINE_VERSION,
        verifiedAt,
      };
    }
    const roots = opts.trustRoots ?? (await getTrustRoots());

    // v0.7.16 — Multi-sig intermediate pooling. Parse every signature's CMS
    // upfront and collect all non-signer certificates. When a signer omits the
    // chain in its own CMS (real case: Magaly's sig in iCert-EC judicial PDFs),
    // we can still build the path using intermediates carried by sibling
    // signatures in the same PDF.
    const allIntermediates: import('pkijs').Certificate[] = [];
    for (const sig of sigs) {
      try {
        const cms = await parseCms(sig.contents);
        allIntermediates.push(cms.signerCert, ...cms.intermediates);
      } catch {
        // ignore — verifyOneSignature will surface the parse error per-sig
      }
    }
    const pooledIntermediates = mergeCertsDedup(allIntermediates);

    // The "latest" signature is the one whose covered byte range extends
    // furthest into the file (largest c+d). Earlier sigs always have bytes
    // after them (subsequent legitimate sigs) and must NOT be flagged with
    // `incremental_updates`. Compare against ALL signatures including the
    // document timestamp — the DTS appended at EOF means the user sig before
    // it is correctly NOT the latest, but its appended bytes are the DTS
    // (legitimate), so we treat it as latest for incremental_updates purposes.
    let latestEnd = -1;
    for (const s of allSigs) {
      const end = s.byteRange[2] + s.byteRange[3];
      if (end > latestEnd) latestEnd = end;
    }
    let latestIdx = 0;
    let latestSigEnd = -1;
    for (const [i, s] of sigs.entries()) {
      const end = s.byteRange[2] + s.byteRange[3];
      if (end > latestSigEnd) {
        latestSigEnd = end;
        latestIdx = i;
      }
    }
    // DocTimeStamp metadata: byte-ranges of /ETSI.RFC3161 sigs (B-LTA wraps).
    // Used to suppress spurious `incremental_updates` warnings on the user
    // sig that the DTS legitimately follows.
    const dtsSigs = allSigs.filter((s) => s.subFilter === 'ETSI.RFC3161');
    const results = await Promise.all(
      sigs.map((sig, i) => {
        // The bytes appended right after this user sig are accounted for by a
        // DTS iff some DTS's coverage starts exactly where this sig ends and
        // its coverage reaches EOF. PAdES DTS has byteRange [0, b, c, d] where
        // b coincides with the sig dict gap and the DTS covers everything up
        // to a+b (user-sig end). We check that any DTS exists with its
        // byteRange starting at offset 0 and ending at or past EOF — that's
        // the canonical B-LTA wrap.
        const sigEnd = sig.byteRange[2] + sig.byteRange[3];
        const wrappedByDts = dtsSigs.some((dts) => {
          const dtsEnd = dts.byteRange[2] + dts.byteRange[3];
          // DTS appears after this user sig and reaches EOF.
          return dts.byteRange[1] >= sigEnd - 4 && dtsEnd >= pdfBytes.length - 4;
        });
        return verifyOneSignature(
          pdfBytes,
          sig,
          opts,
          roots,
          verifiedAt,
          pooledIntermediates,
          i === latestIdx,
          wrappedByDts,
        );
      }),
    );
    // Compute aggregate status — worst-case wins.
    const rank: Record<Status, number> = {
      valid: 0,
      warning: 1,
      no_signature: 2,
      invalid: 3,
    };
    const overallStatus = results.reduce<Status>(
      (acc, r) => (rank[r.status] > rank[acc] ? r.status : acc),
      'valid',
    );
    return {
      signatureCount: results.length,
      signatures: results,
      overallStatus,
      engineVersion: ENGINE_VERSION,
      verifiedAt,
    };
  } catch (e) {
    const code = e instanceof VerificationError ? e.code : 'unknown';
    // Pre-iteration error (bad PDF header, malformed /ByteRange): surface as
    // a single 'invalid' aggregate so the caller has a deterministic shape.
    return {
      signatureCount: 0,
      signatures: [
        {
          status: 'invalid',
          warnings: [],
          engineVersion: ENGINE_VERSION,
          verifiedAt,
          error: `${code}: ${(e as Error).message}`,
        },
      ],
      overallStatus: 'invalid',
      engineVersion: ENGINE_VERSION,
      verifiedAt,
    };
  }
}
