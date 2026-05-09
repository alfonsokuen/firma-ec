export type SignErrorCode =
  | 'bad_pdf'
  | 'bad_p12'
  | 'bad_pin'
  | 'no_signing_cert'
  | 'weak_alg'
  | 'cert_expired'
  | 'cert_not_yet_valid'
  | 'visible_sig_oob'
  | 'pdf_encrypted'
  | 'pdf_too_large'
  | 'webcrypto_unsupported'
  | 'sign_failed'
  | 'unknown';

export class SignerError extends Error {
  constructor(
    public readonly code: SignErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SignerError';
  }
}
