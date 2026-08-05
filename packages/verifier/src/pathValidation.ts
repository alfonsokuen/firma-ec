import { digest, isWithinValidity, toHex } from '@firma-ec/crypto-core';
import type { TrustRoot } from '@firma-ec/tsl-ec';
import { fromBER } from 'asn1js';
import { Certificate, CertificateChainValidationEngine } from 'pkijs';
import { ERR_CHAIN_FAIL, VerificationError } from './errors';

export interface PathResult {
  success: boolean;
  matchedRoot?: TrustRoot | undefined;
  chain: Certificate[];
  error?: string | undefined;
  /** Specific check warnings (e.g., key usage borderline, placeholder roots skipped) */
  warnings: string[];
  /**
   * True when the leaf→issuer walk could NOT reach a self-signed certificate
   * at all — i.e. some certificate in the middle of the chain has no known
   * issuer in the supplied cert pool (signer cert + intermediates + trusted
   * roots).
   *
   * SECURITY NOTE (2026-08-05 CRITICAL fix): the pool the walk climbs
   * includes `intermediates`, which are the certificates the SIGNER chose to
   * embed in the CMS — attacker-controlled input. An attacker can mint their
   * own rogue CA, sign a leaf with it, and simply NOT embed the rogue CA in
   * the PDF. The walk then gets stuck for exactly the same reason a
   * legitimate-but-not-yet-bundled intermediate would: no issuer found in the
   * pool. `chainIncomplete` therefore CANNOT be used to distinguish "this is
   * probably a real ACE we haven't bundled yet" from "this is a forged
   * chain" — the signer controls the signal. It exists ONLY to pick a more
   * honest user-facing MESSAGE (mentions "an intermediate CA may be
   * missing" instead of a blunt fraud-sounding message). It must NEVER be
   * used to weaken the verdict `status` below `invalid`/rejected — consumers
   * keep rejecting exactly as they do for a known-but-unaccredited root.
   * Always `false` when `success` is `true`.
   */
  chainIncomplete: boolean;
}

/**
 * Walk from `leaf` upward through `pool` (candidate issuer certs) following
 * issuer links until a self-signed certificate is reached, or the walk gets
 * stuck because no cert in `pool` matches the current issuer. Returns the
 * terminal self-signed certificate when reached, or `undefined` when the
 * chain could not be completed — i.e. a subordinate CA cert is missing from
 * `pool` (bundled intermediates + roots), NOT that the terminal CA is known
 * but untrusted.
 */
function walkToSelfSigned(leaf: Certificate, pool: Certificate[]): Certificate | undefined {
  let cur: Certificate | undefined = leaf;
  for (let i = 0; i < 12 && cur !== undefined; i++) {
    if (cur.subject.isEqual(cur.issuer)) return cur;
    const issuer: Certificate | undefined = pool.find((c) => c.subject.isEqual(cur!.issuer));
    if (!issuer || issuer === cur) return undefined;
    cur = issuer;
  }
  return undefined;
}

function pemToCert(pem: string): Certificate {
  const b64 = pem.replace(/-----BEGIN [A-Z ]+-----|-----END [A-Z ]+-----|\s/g, '');
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const asn = fromBER(
    der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer,
  );
  if (asn.offset === -1) throw new Error('PEM ASN.1 decode failed');
  return new Certificate({ schema: asn.result });
}

export async function validatePath(
  signerCert: Certificate,
  intermediates: Certificate[],
  roots: TrustRoot[],
  atTime: Date,
): Promise<PathResult> {
  const warnings: string[] = [];

  // Convert TrustRoot PEMs to pkijs Certificates; skip placeholders and fingerprint mismatches
  const trustedCerts: Certificate[] = [];
  const usableRoots: TrustRoot[] = [];

  for (const r of roots) {
    if (r.isPlaceholder) continue;

    try {
      const cert = pemToCert(r.pemContent);
      // Verify fingerprint matches what TSL claims — guard against silent cert substitution
      const der = new Uint8Array(cert.toSchema().toBER(false));
      const fp = toHex(await digest('SHA-256', der));
      if (fp !== r.fingerprintSha256) {
        warnings.push(
          `TSL fingerprint mismatch for ${r.slug}: tsl=${r.fingerprintSha256.slice(0, 16)} actual=${fp.slice(0, 16)}`,
        );
        continue; // refuse to trust a root whose fingerprint changed silently
      }
      trustedCerts.push(cert);
      usableRoots.push(r);
    } catch (e) {
      warnings.push(`Failed to parse trust root ${r.slug}: ${(e as Error).message}`);
    }
  }

  if (trustedCerts.length === 0) {
    const allPlaceholders = roots.length > 0 && roots.every((r) => r.isPlaceholder);
    const error = allPlaceholders
      ? 'All trust roots are placeholders; replace PEMs before enabling chain validation'
      : 'No usable trust roots after fingerprint check';
    return {
      success: false,
      chain: [],
      warnings,
      chainIncomplete: false,
      ...(error ? { error } : {}),
    };
  }

  // Run pkijs chain validation
  const engine = new CertificateChainValidationEngine({
    certs: [signerCert, ...intermediates],
    trustedCerts,
    checkDate: atTime,
  });

  let result;
  try {
    result = await engine.verify();
  } catch (e) {
    const msg = `Chain engine threw: ${(e as Error).message}`;
    return { success: false, chain: [], error: msg, warnings, chainIncomplete: false };
  }

  if (!result.result) {
    const error = result.resultMessage ?? 'pkijs chain validation failed';
    // `chainIncomplete` only selects which MESSAGE to show (see the doc on
    // the field above) — it must never soften `status` in the caller, since
    // `intermediates` is attacker-controlled (embedded by the signer).
    const pool = [...trustedCerts, ...intermediates];
    const reachedSelfSigned = walkToSelfSigned(signerCert, pool) !== undefined;
    return { success: false, chain: [], error, warnings, chainIncomplete: !reachedSelfSigned };
  }

  // v0.7.21 — Do NOT trust pkijs's `result.certificatePath` ordering for the
  // matched-root lookup. In multi-sig PDFs we feed pkijs a large pool of certs
  // (leaves + intermediates + roots from every sibling signature). pkijs's
  // engine returns the FIRST chain that verifies across `certs[]`, not
  // necessarily the chain rooted at `signerCert`. Symptom: 4 iCert sigs got
  // matchedRootSlug=argosdata and Alfonso's ArgosData sig got
  // matchedRootSlug=judicatura — a symmetric swap.
  //
  // Robust approach: walk from signerCert.issuer upward through the pool until
  // we hit a self-signed cert (root), then match THAT subject to a TSL root.
  const chain: Certificate[] = result.certificatePath ?? [];
  let matchedRoot: TrustRoot | undefined;
  const issuerPool: Certificate[] = [...trustedCerts, ...intermediates];
  const selfSigned = walkToSelfSigned(signerCert, issuerPool);
  if (selfSigned) {
    for (const r of usableRoots) {
      try {
        const rootCert = pemToCert(r.pemContent);
        if (rootCert.subject.isEqual(selfSigned.subject)) {
          matchedRoot = r;
          break;
        }
      } catch {
        /* skip */
      }
    }
  }

  if (!matchedRoot) {
    return {
      success: false,
      chain,
      error: 'Chain validated but no matching ARCOTEL root found',
      warnings,
      // pkijs already reported the FULL chain as valid (`result.result`), so
      // reaching this branch means a self-signed anchor WAS found but it
      // doesn't match any usable TSL root — a known-but-untrusted root, not a
      // missing link. Never soften this verdict.
      chainIncomplete: false,
    };
  }

  // Check signer cert key usage — digitalSignature (bit 0) or nonRepudiation (bit 1)
  const ku = signerCert.extensions?.find((e) => e.extnID === '2.5.29.15');
  if (ku) {
    // parsedValue is typed loosely; access via any — pkijs typing limitation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const kuBytes = new Uint8Array((ku.parsedValue as any).valueBlock.valueHex as ArrayBuffer);
    const firstByte = kuBytes[0] ?? 0;
    // Bit 0 (MSB) = digitalSignature, Bit 1 = nonRepudiation
    if (!(firstByte & 0x80) && !(firstByte & 0x40)) {
      warnings.push('Signer cert keyUsage does not include digitalSignature or nonRepudiation');
    }
  }

  // Check validity at signing time (pkijs also checks this, but explicit guard here)
  if (!isWithinValidity(signerCert, atTime)) {
    return {
      success: false,
      chain,
      matchedRoot,
      error: `Signer cert not valid at ${atTime.toISOString()}`,
      warnings,
      chainIncomplete: false,
    };
  }

  // Throw on clear trust-anchor violations (belt-and-suspenders after pkijs verify)
  void VerificationError; // imported for future direct throws
  void ERR_CHAIN_FAIL;

  const successResult: PathResult = { success: true, chain, warnings, chainIncomplete: false };
  // Conditional spread for exactOptionalPropertyTypes
  if (matchedRoot !== undefined) successResult.matchedRoot = matchedRoot;
  return successResult;
}
