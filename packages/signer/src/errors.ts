/**
 * Error codes raised by @firma-ec/signer.
 *
 * Grouped by phase:
 *  - PKCS#12 parsing: pin_invalid, pfx_corrupt, pfx_unsupported_algo, no_signing_cert
 *  - Cert validity: cert_expired, cert_not_yet_valid, weak_alg
 *  - PDF processing: bad_pdf, pdf_encrypted, pdf_too_large, visible_sig_oob
 *  - Signing: webcrypto_unsupported, sign_failed
 *  - Multi-firma / incremental update: incremental_update_failed,
 *    cannot_add_signature_to_corrupt_pdf, pdf_was_modified_after_signature
 *  - Catch-all: unknown
 *
 * Legacy aliases (kept for backward compat with smoke test + scaffold):
 *  - bad_p12 → use pfx_corrupt
 *  - bad_pin → use pin_invalid
 */
export type SignErrorCode =
  // PKCS#12 parse phase
  | 'pin_invalid'
  | 'pfx_corrupt'
  | 'pfx_unsupported_algo'
  | 'no_signing_cert'
  // Cert validity
  | 'cert_expired'
  | 'cert_not_yet_valid'
  | 'weak_alg'
  // PDF phase
  | 'bad_pdf'
  | 'pdf_encrypted'
  | 'pdf_too_large'
  | 'visible_sig_oob'
  // Signing phase
  | 'webcrypto_unsupported'
  | 'webcrypto_unsupported_alg'
  | 'sign_failed'
  | 'cms_build_failed'
  | 'signature_too_long'
  // Multi-firma / incremental update phase
  | 'incremental_update_failed'
  | 'cannot_add_signature_to_corrupt_pdf'
  | 'pdf_was_modified_after_signature'
  // Legacy aliases (deprecated, kept for compat)
  | 'bad_p12'
  | 'bad_pin'
  // Catch-all
  | 'unknown';

export class SignerError extends Error {
  constructor(
    public readonly code: SignErrorCode,
    message: string,
    public override cause?: unknown,
  ) {
    super(message);
    this.name = 'SignerError';
  }
}
