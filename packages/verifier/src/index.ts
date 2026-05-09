import { findSignature } from './pdf';
import { parseCms } from './cms';
import { validatePath } from './pathValidation';
import { checkOcsp } from './ocsp';
import { checkIntegrity } from './integrity';
import type { TrustRoot } from '@firma-ec/tsl-ec';
import { getTrustRoots } from '@firma-ec/tsl-ec';
import type { VerificationResult } from './result';
import { VerificationError } from './errors';

export type { VerificationResult, Status, SignerSummary, SignatureMeta, OcspStatus, IntegrityCheck, VerificationWarning } from './result';
export { VerificationError } from './errors';

export const ENGINE_VERSION = '0.2.0-dev';

export interface VerifyOptions {
  /** Whether to query OCSP responders. Default true; set false for offline mode. */
  fetchOcsp?: boolean | undefined;
  /** Override the TSL roots; default empty (getTrustRoots implemented in Tasks 6-11). */
  trustRoots?: TrustRoot[] | undefined;
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
    const roots: TrustRoot[] = opts.trustRoots ?? (await getTrustRoots());
    const path = await validatePath(cms.signerCert, cms.intermediates, roots, cms.signingTime ?? new Date());
    // Unused at skeleton stage — wired here to validate types compile correctly
    void checkOcsp;
    void checkIntegrity;
    void path;
    // … assemble VerificationResult based on path + integrity + ocsp results …
    return { status: 'invalid', warnings, engineVersion: ENGINE_VERSION, verifiedAt, error: 'verifyPdf wiring not yet complete (Tasks 6-11)' };
  } catch (e) {
    const code = e instanceof VerificationError ? e.code : 'unknown';
    return { status: 'invalid', warnings, engineVersion: ENGINE_VERSION, verifiedAt, error: `${code}: ${(e as Error).message}` };
  }
}
