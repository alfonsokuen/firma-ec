/**
 * dss.ts — F7 T21.
 *
 * Thin wrapper around `@firma-ec/dss-pdf.parseDss` that adapts the parsed
 * shape into the verifier's `DssData` view (re-export). On no-DSS the parser
 * returns `null`; we surface that as `undefined` per the verifier convention
 * (`signature.ltv?: LtvSummary`). On malformed DSS we still return
 * `undefined` and accumulate a warning at the call site — corrupted LTV must
 * never invalidate the outer signature (spec §6.4 — LT-as-warning).
 *
 * Browser-compatible. No node:* imports.
 */

import { parseDss, type ParsedDss, DssParseError } from '@firma-ec/dss-pdf';

export type DssData = ParsedDss;

export interface ExtractDssOutcome {
  /** Parsed DSS dict (cert / OCSP / CRL streams + VRI). undefined when none. */
  data: DssData | undefined;
  /** Failure reason when DSS structure was present but malformed. */
  error?: string;
}

/**
 * Extract the DSS dictionary from a PDF. Robust to absent DSS (returns
 * `data: undefined` with no error) and to corruption (returns `data:
 * undefined` with a populated `error` so the verifier can surface a warning
 * rather than crash).
 */
export function extractDss(pdfBytes: Uint8Array): ExtractDssOutcome {
  try {
    const parsed = parseDss(pdfBytes);
    if (parsed === null) return { data: undefined };
    return { data: parsed };
  } catch (e) {
    if (e instanceof DssParseError) {
      return { data: undefined, error: `dss_malformed: ${e.code}: ${e.message}` };
    }
    return { data: undefined, error: `dss_unknown_error: ${(e as Error).message}` };
  }
}
