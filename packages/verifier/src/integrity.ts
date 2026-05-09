import type { IntegrityCheck } from './result';

export async function checkIntegrity(): Promise<IntegrityCheck> {
  return { digestMatches: false, hasIncrementalUpdates: false, coveredBytes: 0, totalBytes: 0 };
}
