/**
 * @firma-ec/signer — PAdES-B-B signing for browser PWAs.
 *
 * F3 scaffolding (Tasks 1-3). Implementation lands in Tasks 4+.
 *
 * @see docs/superpowers/specs/2026-05-09-firma-ec-F3-firma-MVP-design.md
 */

import { SignerError } from './errors.js';
import type { SignOptions, SignResult } from './types.js';

export { SignerError } from './errors.js';
export type { SignErrorCode } from './errors.js';
export { parsePfx } from './p12.js';
export { signPdfPades } from './pades.js';
export type { PadesSignOptions } from './pades.js';
export { addIncrementalSignature } from './incrementalUpdate.js';
export { detectSignatures } from './detectExistingSignatures.js';
export type { ExistingSignature } from './detectExistingSignatures.js';
export { importPrivateKey, signWithKey, hashOf } from './webcrypto.js';
export { buildCmsSignedData } from './cms.js';
export type {
  ParsedPfx,
  SigAlg,
  SignerCert,
  SignOptions,
  SignResult,
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
