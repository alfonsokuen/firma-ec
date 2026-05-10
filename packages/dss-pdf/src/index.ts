/**
 * @firma-ec/dss-pdf — PAdES B-LT DSS dictionary writer + B-LTA document
 * timestamp incremental update writer.
 *
 * Browser-compatible. No node:* imports.
 *
 * NOTE: This package is bootstrapped as a skeleton in F7 Batch I (T2).
 * The actual writers (`appendDss`, `appendDocumentTimestamp`, `parseDss`,
 * `findDocumentTimestamps`) are implemented in F7 Batch III (Group E,
 * Tasks 11-15) per docs/superpowers/plans/2026-05-10-firma-ec-F7-LTV.md.
 *
 * Public surface declared here as a typed contract so dependents
 * (signer, verifier) can begin importing types in parallel batches.
 */

import type { OcspResult, CrlResult, ParsedCert } from '@firma-ec/ltv-validation';

/** Validation Related Information entry, keyed by uppercase hex SHA-1 of /Contents. */
export interface VriEntry {
  certIndices: number[];
  ocspIndices: number[];
  crlIndices: number[];
  /** Index of the timestamp token in /OCSPs[] when present. */
  timestampTokenIndex?: number;
}

/** Data layer produced by collectDssData() — bytes ready to be packaged into PDF objects. */
export interface DssData {
  /** DER cert bytes, deduped by SHA-256(der). */
  certs: Uint8Array[];
  /** BasicOCSPResponse DER streams. */
  ocsps: Uint8Array[];
  /** CertificateList DER streams. */
  crls: Uint8Array[];
  /** VRI keyed by uppercase hex SHA-1 of signature /Contents bytes. */
  vri: Record<string, VriEntry>;
}

export interface AppendDssOpts {
  /** PDF bytes to extend (typically a B-T PDF). */
  pdfBytes: Uint8Array;
  /** DSS data layer. */
  dss: DssData;
}

export interface ParsedDss {
  /** Cert DER bytes recovered from /Certs streams (in array order). */
  certs: Uint8Array[];
  /** OCSP DER bytes from /OCSPs streams. */
  ocsps: Uint8Array[];
  /** CRL DER bytes from /CRLs streams. */
  crls: Uint8Array[];
  /** /VRI map, keys are uppercase hex SHA-1 of signature /Contents. */
  vri: Record<string, VriEntry>;
}

export interface DocumentTimestampInfo {
  /** /ByteRange [a, b, c, d]. */
  byteRange: [number, number, number, number];
  /** Token DER (TimeStampToken ContentInfo). */
  tokenDer: Uint8Array;
  /** Bytes covered by the /ByteRange (used to verify the imprint sealed by the TSA). */
  coveredBytes: Uint8Array;
}

export interface AppendDocumentTimestampOpts {
  pdfBytes: Uint8Array;
  /** TSA URL. Default https://freetsa.org/tsr (set via tsa-client default). */
  tsaUrl?: string;
  timeoutMs?: number;
}

// Re-export the shapes we accept so callers don't need to import from
// the upstream packages explicitly.
export type { OcspResult, CrlResult, ParsedCert };

/** Stub — implemented in F7 Batch III (T11). */
export function parseDss(_pdfBytes: Uint8Array): ParsedDss | null {
  throw new Error('@firma-ec/dss-pdf: parseDss not implemented (F7 Batch III T11)');
}

/** Stub — implemented in F7 Batch III (T12). */
export function appendDss(_opts: AppendDssOpts): Promise<Uint8Array> {
  throw new Error('@firma-ec/dss-pdf: appendDss not implemented (F7 Batch III T12)');
}

/** Stub — implemented in F7 Batch III (T13). */
export function findDocumentTimestamps(_pdfBytes: Uint8Array): DocumentTimestampInfo[] {
  throw new Error('@firma-ec/dss-pdf: findDocumentTimestamps not implemented (F7 Batch III T13)');
}

/** Stub — implemented in F7 Batch III (T14). */
export function appendDocumentTimestamp(
  _opts: AppendDocumentTimestampOpts,
): Promise<{ ok: true; pdfBytes: Uint8Array } | { ok: false; reason: string; detail?: string }> {
  throw new Error('@firma-ec/dss-pdf: appendDocumentTimestamp not implemented (F7 Batch III T14)');
}
