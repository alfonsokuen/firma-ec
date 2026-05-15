/**
 * Shared data shape for LtvBadge.svelte.
 *
 * Mirrors @firma-ec/verifier's LtvSummary AND the (subset of)
 * @firma-ec/signer's LtvMeta needed to render the badge from the firmar
 * wizard. The signer emits B-LTA + counts; the verifier emits the same
 * shape plus the documentTimestamp sub-object for rendering archive time.
 */
export interface LtvBadgeData {
  profile: 'B-B' | 'B-T' | 'B-LT' | 'B-LTA';
  dssPresent?: boolean;
  embeddedOcspCount: number;
  embeddedCrlCount: number;
  retrospectiveValid?: boolean;
  documentTimestamp?:
    | {
        present: boolean;
        valid: boolean;
        badge: 'gold' | 'silver' | 'none';
        signingTime?: string | undefined;
        tsaIssuer?: string | undefined;
        reason?: string | undefined;
      }
    | undefined;
}

/** Adapter: build LtvBadgeData from a signer LtvMeta. */
export function ltvBadgeFromMeta(meta: {
  profile: 'B-B' | 'B-T' | 'B-LT' | 'B-LTA';
  embeddedOcspCount: number;
  embeddedCrlCount: number;
  archiveAchieved: boolean;
  documentTimestampTime?: Date | undefined;
  documentTimestampTsaIssuer?: string | undefined;
}): LtvBadgeData {
  const out: LtvBadgeData = {
    profile: meta.profile,
    dssPresent: meta.profile === 'B-LT' || meta.profile === 'B-LTA',
    embeddedOcspCount: meta.embeddedOcspCount,
    embeddedCrlCount: meta.embeddedCrlCount,
    retrospectiveValid: true, // signer only produces DSS when fetches succeed
  };
  if (meta.archiveAchieved) {
    out.documentTimestamp = {
      present: true,
      valid: true,
      badge: 'gold',
      ...(meta.documentTimestampTime
        ? { signingTime: meta.documentTimestampTime.toISOString() }
        : {}),
      ...(meta.documentTimestampTsaIssuer ? { tsaIssuer: meta.documentTimestampTsaIssuer } : {}),
    };
  }
  return out;
}
