import { VerificationError, ERR_PDF_PARSE } from './errors';

export interface SignedRange {
  /** ByteRange tuple: [a, b, c, d] from the /Sig dictionary */
  byteRange: [number, number, number, number];
  /** The signature bytes from /Contents (DER PKCS#7) */
  contents: Uint8Array;
  /** Whether there are increments after the /Sig object */
  hasIncrementalUpdates: boolean;
  /** Optional appearance reason */
  reason?: string | undefined;
  /** Optional location */
  location?: string | undefined;
}

export async function findSignature(_pdfBytes: Uint8Array): Promise<SignedRange | null> {
  throw new VerificationError(ERR_PDF_PARSE, 'pdf.ts not yet implemented (Task 6)');
}
