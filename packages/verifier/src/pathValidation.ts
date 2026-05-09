import type { Certificate } from 'pkijs';
import type { TrustRoot } from '@firma-ec/tsl-ec';

export interface PathResult {
  success: boolean;
  matchedRoot?: TrustRoot | undefined;
  error?: string | undefined;
}

export async function validatePath(
  _signer: Certificate,
  _intermediates: Certificate[],
  _roots: TrustRoot[],
  _atTime: Date,
): Promise<PathResult> {
  throw new Error('pathValidation.ts not yet implemented (Task 8)');
}
