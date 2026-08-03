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
  | 'visible_sig_out_of_bounds'
  | 'visible_sig_invalid_page'
  | 'visible_sig_too_small'
  | 'visible_sig_not_finite'
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
  // LTV (F7) phase — only fatal LTV error: revoked certificate.
  | 'certificate_revoked'
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

/**
 * ¿Este fallo de `PDFDocument.load` es "el documento está cifrado"?
 *
 * pdf-lib exporta `EncryptedPDFError`, pero su jerarquía de errores pierde la
 * cadena de prototipos al transpilarse, así que `instanceof` devuelve `false`
 * incluso para la instancia que ella misma lanzó (verificado con pdf-lib
 * 1.17.1). La discriminación va por el mensaje, que es una constante literal de
 * la librería, y se ancla a dos marcas para no confundirlo con cualquier texto
 * que mencione cifrado.
 */
export function isEncryptedPdfError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.includes('is encrypted') && message.includes('ignoreEncryption');
}

/**
 * F7 — factory for the fatal LTV error. Thrown when OCSP returns `revoked`
 * for any cert in the chain that the signer needs to validate (typically the
 * signer cert itself). Signing must abort: a revoked cert cannot produce a
 * legally valid signature regardless of LTV embedding.
 */
export function revokedError(cn: string): SignerError {
  return new SignerError(
    'certificate_revoked',
    `El certificado de ${cn} está revocado y no puede usarse para firmar.`,
  );
}
