/**
 * @firma-ec/signer — PAdES-B-B signing for browser PWAs.
 *
 * F3 scaffolding (Tasks 1-3). Implementation lands in Tasks 4+.
 *
 * @see docs/superpowers/specs/2026-05-09-firma-ec-F3-firma-MVP-design.md
 */

import { SignerError } from './errors.js';
import type { SignOptions, SignResult } from './types.js';

export { SignerError, revokedError } from './errors.js';
export type { SignErrorCode } from './errors.js';
export { parsePfx } from './p12.js';
export { signPdfPades, ltvNotApplicable } from './pades.js';
export type { PadesSignOptions, PadesSignResult } from './pades.js';
export { collectLtvData, extractSignatureContents } from './ltv.js';
export type { CollectLtvOpts, CollectLtvResult } from './ltv.js';
export { addIncrementalSignature } from './incrementalUpdate.js';
export {
  attachVisibleSignatureAppearance,
  buildAppearanceOperators,
  embedHelvetica,
  truncateCN,
  validateVisibleSig,
  DEFAULT_VISIBLE_SIG_WIDTH,
  DEFAULT_VISIBLE_SIG_HEIGHT,
  MIN_VISIBLE_SIG_WIDTH,
  MIN_VISIBLE_SIG_HEIGHT,
} from './visibleSig.js';
export type { VisibleSigInput } from './visibleSig.js';
export { detectSignatures } from './detectExistingSignatures.js';
export type { ExistingSignature } from './detectExistingSignatures.js';
export { importPrivateKey, signWithKey, hashOf } from './webcrypto.js';
export { buildCmsSignedData } from './cms.js';
export type { BuildCmsOpts, BuildCmsResult } from './cms.js';
export type {
  LtvMeta,
  LtvOpts,
  LtvProfile,
  ParsedPfx,
  SigAlg,
  SignerCert,
  SignOptions,
  SignResult,
  TimestampMeta,
  VisibleSigSpec,
} from './types.js';

/**
 * Sign a PDF with PAdES-B-B (CAdES detached, /Adobe.PPKLite).
 *
 * **Not implemented yet** — placeholder for F3 Tasks 4+.
 */
export async function signPdf(_opts: SignOptions): Promise<SignResult> {
  throw new SignerError('unknown', '@firma-ec/signer: signPdf not implemented (F3 Task 4+)');
}
