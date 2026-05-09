import type { Certificate } from 'pkijs';

export interface ParsedCms {
  signerCert: Certificate;
  intermediates: Certificate[];
  digestAlgoOid: string;
  signatureAlgoOid: string;
  signedMessageDigest: Uint8Array;
  signingTime?: Date | undefined;
  timestampToken?: Uint8Array | undefined;
  reason?: string | undefined;
}

export async function parseCms(_contents: Uint8Array): Promise<ParsedCms> {
  throw new Error('cms.ts not yet implemented (Task 7)');
}
