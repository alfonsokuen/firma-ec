export class VerificationError extends Error {
  // noImplicitOverride: cause is already on Error in ES2022 lib, declare override
  constructor(public code: string, message: string, public override cause?: unknown) {
    super(message);
    this.name = 'VerificationError';
  }
}

export const ERR_NO_SIG = 'no_signature';
export const ERR_PDF_PARSE = 'pdf_parse';
export const ERR_CMS_PARSE = 'cms_parse';
export const ERR_BYTERANGE_INVALID = 'byterange_invalid';
export const ERR_DIGEST_MISMATCH = 'digest_mismatch';
export const ERR_CHAIN_FAIL = 'chain_validation_failed';
export const ERR_NOT_TRUSTED_AC = 'untrusted_ac';
export const ERR_OCSP_REVOKED = 'ocsp_revoked';
export const ERR_WEAK_HASH = 'weak_hash';
export const ERR_WEAK_SIG = 'weak_signature_algorithm';
export const ERR_RSA_TOO_SMALL = 'rsa_key_too_small';
