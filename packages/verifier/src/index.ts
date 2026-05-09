import { findSignature } from './pdf';
import { parseCms } from './cms';
import { validatePath } from './pathValidation';
import { checkOcsp } from './ocsp';
import { checkDocumentIntegrity, verifySignatureValue } from './integrity';
import { getTrustRoots } from '@firma-ec/tsl-ec';
import { subjectInfo, issuerInfo, digest, toHex } from '@firma-ec/crypto-core';
import type { VerificationResult, Status } from './result';
import { VerificationError } from './errors';

export type { VerificationResult, Status, SignerSummary, SignatureMeta, OcspStatus, IntegrityCheck, VerificationWarning } from './result';
export { VerificationError } from './errors';

export const ENGINE_VERSION = '0.2.0-dev';

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

    // Path validation
    const path = await validatePath(cms.signerCert, cms.intermediates, roots, cms.signingTime ?? new Date());

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

    // Compute final status
    let status: Status;
    if (!docCheck.matches) status = 'invalid';
    else if (!sigValid) status = 'invalid';
    else if (!path.success) status = 'invalid';
    else if (ocsp?.status === 'revoked') status = 'invalid';
    else if (sig.hasIncrementalUpdates) {
      status = 'warning';
      warnings.push({ code: 'incremental_updates', message: 'PDF has bytes appended after the signature; signature does not cover them.' });
    } else if (ocsp?.status === 'not_checked' || ocsp?.status === 'unknown') {
      status = 'warning';
      warnings.push({ code: 'ocsp_unavailable', message: 'OCSP responder did not return a definitive status for this certificate.' });
    } else {
      status = 'valid';
    }

    // Forward TSL warnings
    for (const w of path.warnings ?? []) warnings.push({ code: 'tsl_warning', message: w });

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
        profile: cms.timestampToken ? 'B-T' : 'B-B',
        digestAlgo: cms.digestAlgoOid,
        signatureAlgo: cms.signatureAlgoOid,
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
