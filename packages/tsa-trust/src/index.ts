/**
 * @firma-ec/tsa-trust — RFC 3161 TSA trust roots + chain validation.
 *
 * Decoupled from @firma-ec/tsl-ec on purpose: TSA anchors and ARCOTEL ECI
 * anchors have independent rotation cycles and semantics (spec §4 / decision #8).
 *
 * Browser-compatible: PEMs are imported via Vite's `?raw` suffix (handled in
 * tests by the rawAssetPlugin in vitest.config.ts).
 */

import { fromBER } from 'asn1js';
import { Certificate, CertificateChainValidationEngine } from 'pkijs';
import { TSA_TRUST_MANIFEST, type TsaTrustManifestEntry } from './manifest';
import arcotelPlaceholderPem from './roots/arcotel-placeholder.pem?raw';
import freetsaPem from './roots/freetsa.pem?raw';

export type { TsaTrustManifestEntry } from './manifest';

const PEM_BY_SLUG: Record<string, string> = {
  freetsa: freetsaPem,
  'arcotel-placeholder': arcotelPlaceholderPem,
};

/** OID for id-kp-timeStamping EKU. */
const OID_KP_TIME_STAMPING = '1.3.6.1.5.5.7.3.8';

export interface TsaTrustRoot extends TsaTrustManifestEntry {
  certPem: string;
  certDer: Uint8Array;
  certificate: Certificate;
  notBefore: Date;
  notAfter: Date;
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----BEGIN [A-Z ]+-----|-----END [A-Z ]+-----|\s/g, '');
  // atob is available in Node ≥18 + browsers.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function pemToCert(pem: string): { der: Uint8Array; cert: Certificate } {
  const der = pemToDer(pem);
  const ab = der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer;
  const asn = fromBER(ab);
  if (asn.offset === -1) throw new Error('TSA root PEM ASN.1 decode failed');
  return { der, cert: new Certificate({ schema: asn.result }) };
}

let _cached: TsaTrustRoot[] | null = null;

/**
 * Load + parse all TSA trust roots. Cached after first call.
 *
 * Placeholder roots are returned with the `isPlaceholder: true` flag so callers
 * can skip them when validating real chains.
 */
export function getTsaTrustRoots(): TsaTrustRoot[] {
  if (_cached) return _cached;
  const out: TsaTrustRoot[] = [];
  for (const entry of TSA_TRUST_MANIFEST) {
    const pem = PEM_BY_SLUG[entry.slug];
    if (!pem) throw new Error(`tsa-trust: PEM missing for slug ${entry.slug}`);
    const { der, cert } = pemToCert(pem);
    out.push({
      ...entry,
      certPem: pem,
      certDer: der,
      certificate: cert,
      notBefore: cert.notBefore.value as Date,
      notAfter: cert.notAfter.value as Date,
    });
  }
  _cached = out;
  return out;
}

function getCN(
  rdns: { typesAndValues: { type: string; value: { valueBlock: { value?: string } } }[] }[],
): string | null {
  for (const rdn of rdns) {
    for (const tv of rdn.typesAndValues) {
      if (tv.type === '2.5.4.3') {
        const v = tv.value?.valueBlock?.value;
        if (typeof v === 'string') return v;
      }
    }
  }
  return null;
}

/**
 * Find a trust root whose subject CN matches the provided issuer CN.
 *
 * The lookup is intentionally lenient — production callers should use
 * {@link validateTsaCertChain} for full path validation.
 */
export function findTsaRootByIssuerCN(issuerCN: string): TsaTrustRoot | null {
  const wrap = (cert: Certificate) => [
    {
      typesAndValues: cert.subject.typesAndValues as unknown as {
        type: string;
        value: { valueBlock: { value?: string } };
      }[],
    },
  ];
  for (const root of getTsaTrustRoots()) {
    if (root.isPlaceholder) continue;
    const cn = getCN(wrap(root.certificate));
    if (cn === issuerCN) return root;
  }
  return null;
}

export interface ParsedCertLike {
  certificate: Certificate;
  der: Uint8Array;
  notBefore: Date;
  notAfter: Date;
}

export interface ChainValidationResult {
  ok: boolean;
  reason?: 'tsa_eku_missing' | 'expired' | 'chain_invalid' | 'placeholder_only' | 'engine_error';
  detail?: string;
  matchedRoot?: TsaTrustRoot;
}

function hasTimeStampingEku(cert: Certificate): boolean {
  const exts = cert.extensions ?? [];
  for (const ext of exts) {
    // extnID 2.5.29.37 = extKeyUsage
    if (ext.extnID !== '2.5.29.37') continue;
    const parsed = ext.parsedValue as unknown as { keyPurposes?: string[] } | undefined;
    if (parsed && Array.isArray(parsed.keyPurposes)) {
      if (parsed.keyPurposes.includes(OID_KP_TIME_STAMPING)) return true;
    }
  }
  return false;
}

/**
 * Validate that `tsaCert` chains to a known (non-placeholder) TSA trust root.
 *
 * Checks performed:
 *   1. tsaCert has EKU `id-kp-timeStamping` (1.3.6.1.5.5.7.3.8). RFC 3161 §2.3.
 *   2. tsaCert is within validity (notBefore ≤ atTime ≤ notAfter). RFC 5280.
 *   3. pkijs CertificateChainValidationEngine resolves a path tsaCert (+
 *      intermediates) → trusted root.
 */
export async function validateTsaCertChain(
  tsaCert: ParsedCertLike,
  intermediates: Certificate[] = [],
  atTime: Date = new Date(),
): Promise<ChainValidationResult> {
  // 1. EKU check
  if (!hasTimeStampingEku(tsaCert.certificate)) {
    return {
      ok: false,
      reason: 'tsa_eku_missing',
      detail: 'TSA cert lacks id-kp-timeStamping EKU',
    };
  }

  // 2. Validity window
  if (atTime < tsaCert.notBefore || atTime > tsaCert.notAfter) {
    return {
      ok: false,
      reason: 'expired',
      detail: `validity ${tsaCert.notBefore.toISOString()}..${tsaCert.notAfter.toISOString()}`,
    };
  }

  // 3. Chain build
  const roots = getTsaTrustRoots().filter((r) => !r.isPlaceholder);
  if (roots.length === 0) {
    return {
      ok: false,
      reason: 'placeholder_only',
      detail: 'no usable (non-placeholder) trust roots',
    };
  }

  const trustedCerts = roots.map((r) => r.certificate);

  try {
    const engine = new CertificateChainValidationEngine({
      trustedCerts,
      certs: [...intermediates, tsaCert.certificate],
      checkDate: atTime,
    });
    const verifyResult = await engine.verify();
    const ok = (verifyResult as unknown as { result?: boolean }).result === true;
    if (!ok) {
      return {
        ok: false,
        reason: 'chain_invalid',
        detail:
          (verifyResult as unknown as { resultMessage?: string }).resultMessage ??
          'chain verify failed',
      };
    }
    // Find which root matched (by direct issuer CN comparison fallback).
    const issuerCN = getCN([
      {
        typesAndValues: tsaCert.certificate.issuer.typesAndValues as unknown as {
          type: string;
          value: { valueBlock: { value?: string } };
        }[],
      },
    ]);
    let matchedRoot: TsaTrustRoot | undefined;
    if (issuerCN) {
      matchedRoot = roots.find((r) => {
        const subjectCN = getCN([
          {
            typesAndValues: r.certificate.subject.typesAndValues as unknown as {
              type: string;
              value: { valueBlock: { value?: string } };
            }[],
          },
        ]);
        return subjectCN === issuerCN;
      });
    }
    return matchedRoot ? { ok: true, matchedRoot } : { ok: true };
  } catch (e) {
    return { ok: false, reason: 'engine_error', detail: (e as Error).message ?? String(e) };
  }
}
