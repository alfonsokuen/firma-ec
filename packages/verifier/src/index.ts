import { findSignature } from './pdf';
import { parseCms } from './cms';
import { validatePath } from './pathValidation';
import { checkOcsp } from './ocsp';
import { checkDocumentIntegrity, verifySignatureValue } from './integrity';
import { verifyTimestamp } from './timestamp';
import { getTrustRoots } from '@firma-ec/tsl-ec';
import { subjectInfo, issuerInfo, digest, toHex } from '@firma-ec/crypto-core';
import type { VerificationResult, Status } from './result';
import { VerificationError } from './errors';

export type { VerificationResult, Status, SignerSummary, SignatureMeta, OcspStatus, IntegrityCheck, VerificationWarning, TimestampSummary } from './result';
export type { TimestampVerification, TimestampBadge, TimestampReason } from './timestamp';
export { verifyTimestamp } from './timestamp';
export { VerificationError } from './errors';

// Bump on each release (kept hardcoded — JSON imports require resolveJsonModule
// + downstream tsconfig coupling we'd rather avoid in this package).
export const ENGINE_VERSION = '0.5.0-rc4';

export interface VerifyOptions {
  /** Whether to query OCSP responders. Default true; set false for offline mode. */
  fetchOcsp?: boolean | undefined;
  /** Override the TSL roots; default fetched from @firma-ec/tsl-ec. */
  trustRoots?: Awaited<ReturnType<typeof getTrustRoots>> | undefined;
}

export async function verifyPdf(pdfBytes: Uint8Array, opts: VerifyOptions = {}): Promise<VerificationResult> {
  const verifiedAt = new Date().toISOString();
  const warnings: VerificationResult['warnings'] = [];

  try {
    const sig = await findSignature(pdfBytes);
    if (!sig) {
      return { status: 'no_signature', warnings, engineVersion: ENGINE_VERSION, verifiedAt };
    }

    const cms = await parseCms(sig.contents);
    const roots = opts.trustRoots ?? (await getTrustRoots());

    // Integrity: document hash + signature value
    const docCheck = await checkDocumentIntegrity(pdfBytes, sig.byteRange, cms.digestAlgoOid, cms.signedMessageDigest);
    const sigValid = await verifySignatureValue(cms.signerCert, cms.signatureAlgoOid, cms.digestAlgoOid, cms.signedAttrsDer, cms.signatureValue);

    // F6 — RFC 3161 timestamp verification. Best-effort: never degrades the
    // outer signature validity (silver only adds a warning; spec §6.2).
    const tsaResult = await verifyTimestamp(cms.timestampToken, cms.signatureValue);

    // Path validation
    const path = await validatePath(cms.signerCert, cms.intermediates, roots, cms.signingTime ?? new Date());

    // Detect "trust chain inconclusive due to placeholder TSL" — this is NOT a
    // crypto failure, just a missing trust anchor. We must NOT degrade to
    // 'invalid' in this case: hash + signature are sound, but the trust list
    // hasn't published real ARCOTEL roots yet (F2 / pre-v0.2.0 state). The PWA
    // shows a DEMO banner when this warning code appears.
    //
    // Heuristic: if all TSL roots are placeholders, no real chain can succeed
    // even for a perfectly signed ECI/Security Data PDF. Treat that as
    // 'warning' with code TRUST_PLACEHOLDER (consumed by Verificar.svelte).
    const allRootsPlaceholder = roots.length > 0 && roots.every((r) => r.isPlaceholder);
    const trustInconclusive = !path.success && allRootsPlaceholder;

    // OCSP (optional)
    let ocsp: VerificationResult['ocsp'] = { status: 'not_checked', source: 'none' };
    if (opts.fetchOcsp !== false && path.success && path.matchedRoot) {
      const issuerCert = path.chain[1];  // signer's issuer = next cert in chain
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
    else if (!path.success && !trustInconclusive) status = 'invalid';
    else if (ocsp?.status === 'revoked') status = 'invalid';
    else if (trustInconclusive) {
      status = 'warning';
      warnings.push({
        code: 'TRUST_PLACEHOLDER',
        message:
          'ARCOTEL TSL roots are placeholders; cryptographic checks passed but the trust chain is provisional (not yet binding).',
      });
    } else if (sig.hasIncrementalUpdates) {
      status = 'warning';
      warnings.push({ code: 'incremental_updates', message: 'PDF has bytes appended after the signature; signature does not cover them.' });
    } else if (ocsp?.status === 'not_checked' || ocsp?.status === 'unknown') {
      status = 'warning';
      warnings.push({ code: 'ocsp_unavailable', message: 'OCSP responder did not return a definitive status for this certificate.' });
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

    const subjFp = toHex(await digest('SHA-256', new Uint8Array(cms.signerCert.toSchema().toBER(false))));

    const result: VerificationResult = {
      status,
      signer: {
        cert: {
          subject: subjectInfo(cms.signerCert),
          issuer: issuerInfo(cms.signerCert),
          serialNumberHex: toHex(new Uint8Array(cms.signerCert.serialNumber.valueBlock.valueHex as ArrayBuffer)),
          validFrom: cms.signerCert.notBefore.value.toISOString(),
          validUntil: cms.signerCert.notAfter.value.toISOString(),
          fingerprintSha256: subjFp,
        },
      },
      signature: {
        // F6: B-T only when the timestamp actually verifies. Tokens that fail
        // any check (silver) do NOT upgrade the profile beyond B-B.
        profile: tsaResult.present && tsaResult.valid ? 'B-T' : 'B-B',
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
    if (path.matchedRoot?.slug !== undefined) result.signer!.matchedRootSlug = path.matchedRoot.slug;
    if (path.matchedRoot?.commonName !== undefined) result.signer!.matchedRootName = path.matchedRoot.commonName;
    if (cms.signingTime !== undefined) result.signature!.signingTime = cms.signingTime.toISOString();
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
