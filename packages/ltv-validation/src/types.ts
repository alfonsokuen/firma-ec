/**
 * Public type surface for @firma-ec/ltv-validation.
 * Mirrors spec docs/superpowers/specs/2026-05-10-firma-ec-F7-LTV-design.md §3.1.
 */

/** Minimal parsed-cert shape used by the LTV layer (subset of verifier ParsedCert). */
export interface ParsedCert {
  /** Subject Common Name (or null if absent). */
  subjectCN: string | null;
  /** Issuer Common Name (or null if absent). */
  issuerCN: string | null;
  /** DER bytes of the cert. */
  der: Uint8Array;
  /** notBefore / notAfter from validity. */
  notBefore: Date;
  notAfter: Date;
}

export type RevocationStatus = 'good' | 'revoked' | 'unknown';

export interface OcspResult {
  ok: true;
  /** RFC 6960 BasicOCSPResponse DER bytes — embed in DSS as-is. */
  responseDer: Uint8Array;
  status: RevocationStatus;
  /** OCSP producedAt timestamp. */
  producedAt: Date;
  /** thisUpdate of the matching SingleResponse. */
  thisUpdate: Date;
  /** nextUpdate when present. */
  nextUpdate?: Date;
  /** Revocation date when status === 'revoked'. */
  revokedAt?: Date;
  /** Responder URL actually queried. */
  responderUrl: string;
  /** Responder cert (if delegate; else === issuer). */
  responderCert?: ParsedCert;
  /** Whether the response signature verified against responder cert. */
  signatureValid: boolean;
}

export interface OcspError {
  ok: false;
  reason:
    | 'no_aia'
    | 'timeout'
    | 'network'
    | 'malformed'
    | 'http_error'
    | 'sig_invalid'
    | 'rate_limited'
    /** The response's CertID doesn't answer OUR cert (replay/mismatch), or it
     *  echoed a nonce different from the one we sent. `detail` distinguishes
     *  the two — see `ocsp/response.ts` and `ocsp/fetch.ts`. */
    | 'response_mismatch';
  detail?: string;
}

export type OcspOutcome = OcspResult | OcspError;

export interface CrlResult {
  ok: true;
  crlDer: Uint8Array;
  /** Parsed CRL — caller may inspect revokedCertificates. */
  crl: import('pkijs').CertificateRevocationList;
  thisUpdate: Date;
  nextUpdate?: Date;
  distributionPointUrl: string;
}

export interface CrlError {
  ok: false;
  reason:
    | 'no_cdp'
    | 'timeout'
    | 'network'
    | 'malformed'
    | 'http_error'
    | 'sig_invalid'
    | 'too_large';
  detail?: string;
}

export type CrlOutcome = CrlResult | CrlError;

export interface FetchOcspOpts {
  /** Override URL (else discovered from cert AIA). */
  url?: string;
  /** Same-origin proxy map (F7.5). When set, the resolved URL is rewritten via
   *  applyProxyMap before fetching. Allowlist-only; unmapped URLs pass through. */
  proxyMap?: import('./proxy').ProxyMap;
  /** Timeout ms (default 8000). */
  timeoutMs?: number;
  /** CertID hash algorithm. Default 'auto' tries SHA-256 then falls back to SHA-1. */
  hashAlgo?: 'sha1' | 'sha256' | 'auto';
  /** Include nonce extension (default false — many ARCOTEL responders reject nonces). */
  nonce?: boolean;
  /** AbortSignal for cancellation (overrides timeoutMs). */
  signal?: AbortSignal;
  /** OCSP response cache (per-process, in-memory). */
  cache?: OcspCache;
  /** fetch implementation override (testing). */
  fetchImpl?: typeof globalThis.fetch;
}

export interface FetchCrlOpts {
  url?: string;
  /** Same-origin proxy map (F7.5). When set, the resolved URL is rewritten via
   *  applyProxyMap before fetching. Allowlist-only; unmapped URLs pass through. */
  proxyMap?: import('./proxy').ProxyMap;
  timeoutMs?: number;
  /** Maximum CRL size in bytes (default 8 MiB). */
  maxBytes?: number;
  /** Maximum asn1js node count (default 1_000_000). Large ARCOTEL CRLs exceed asn1js's default 10k. */
  maxNodes?: number;
  /** Issuer cert for signature verification (optional — skip verify when absent). */
  issuerCert?: ParsedCert;
  signal?: AbortSignal;
  /** CRL cache (per-process, in-memory). */
  cache?: CrlCache;
  /** fetch implementation override (testing). */
  fetchImpl?: typeof globalThis.fetch;
}

/** OCSP response cache (per-process, in-memory, TTL 1h default). */
export interface OcspCache {
  get(key: string): OcspResult | undefined;
  set(key: string, value: OcspResult): void;
  clear(): void;
  readonly size: number;
}

/** CRL cache (per-process, in-memory, TTL 6h default since CRLs update less often). */
export interface CrlCache {
  get(key: string): CrlResult | undefined;
  set(key: string, value: CrlResult): void;
  clear(): void;
  readonly size: number;
}

/**
 * F1 — AIA caIssuers fallback (RFC 5280 §4.2.2.1).
 *
 * When the signer's local subordinate-CA bundle doesn't have the
 * intermediate an ACE issued a leaf from, `fetchIssuerCertViaAia` tries to
 * fetch it live from the URL the leaf's own AIA extension publishes. Success
 * only HELPS complete a chain toward an already-trusted root — it can never
 * grant trust by itself: every returned cert is verified (Basic Constraints
 * CA:TRUE + it actually signed the child) before being handed back.
 */
export interface AiaCertResult {
  /** DER of the verified issuer cert. */
  certDer: Uint8Array;
}

export type AiaCertErrorReason =
  | 'no_aia'
  | 'timeout'
  | 'network'
  | 'http_error'
  | 'malformed'
  /** Response parsed fine but none of the candidate certs are CA:TRUE. */
  | 'not_a_ca'
  /** A candidate matched by subject/CA:TRUE but its key did not actually
   *  sign the child cert — never embedded, rejected outright. */
  | 'signature_invalid';

export type AiaCertOutcome =
  | ({ ok: true } & AiaCertResult)
  | { ok: false; reason: AiaCertErrorReason; detail?: string };

export interface FetchIssuerCertViaAiaOpts {
  /** Same-origin proxy map (F7.5-style). Unmapped URLs pass through unchanged. */
  proxyMap?: import('./proxy').ProxyMap;
  /** Timeout ms. Default 5000 — shorter than OCSP's 8s: this is a
   *  never-critical fallback, not the signing critical path. */
  timeoutMs?: number;
  /** AbortSignal for cancellation (overrides timeoutMs). */
  signal?: AbortSignal;
  /** In-memory cache (see `createAiaCertCache`). */
  cache?: AiaCertCache;
  /** fetch implementation override (testing). */
  fetchImpl?: typeof globalThis.fetch;
}

/** AIA-resolved-cert cache (per-process, in-memory, TTL 24h default). */
export interface AiaCertCache {
  get(key: string): AiaCertResult | undefined;
  set(key: string, value: AiaCertResult): void;
  clear(): void;
  readonly size: number;
}
