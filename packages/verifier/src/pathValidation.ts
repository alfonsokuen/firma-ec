import { Certificate, CertificateChainValidationEngine } from 'pkijs';
import { fromBER } from 'asn1js';
import type { TrustRoot } from '@firma-ec/tsl-ec';
import { isWithinValidity, digest, toHex } from '@firma-ec/crypto-core';
import { VerificationError, ERR_CHAIN_FAIL } from './errors';

export interface PathResult {
  success: boolean;
  matchedRoot?: TrustRoot | undefined;
  chain: Certificate[];
  error?: string | undefined;
  /** Specific check warnings (e.g., key usage borderline, placeholder roots skipped) */
  warnings: string[];
}

function pemToCert(pem: string): Certificate {
  const b64 = pem.replace(/-----BEGIN [A-Z ]+-----|-----END [A-Z ]+-----|\s/g, '');
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const asn = fromBER(der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer);
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
    return { success: false, chain: [], warnings, ...(error ? { error } : {}) };
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
    return { success: false, chain: [], error: msg, warnings };
  }

  if (!result.result) {
    const error = result.resultMessage ?? 'pkijs chain validation failed';
    return { success: false, chain: [], error, warnings };
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
  let cur: Certificate | undefined = signerCert;
  const walked: Certificate[] = [signerCert];
  for (let i = 0; i < 12 && cur !== undefined; i++) {
    // Self-signed → cur is the chain anchor.
    if (cur.subject.isEqual(cur.issuer)) {
      for (const r of usableRoots) {
        try {
          const rootCert = pemToCert(r.pemContent);
          if (rootCert.subject.isEqual(cur.subject)) {
            matchedRoot = r;
            break;
          }
        } catch {
          /* skip */
        }
      }
      break;
    }
    // Find the cert in the pool whose subject equals cur.issuer.
    const issuer: Certificate | undefined = issuerPool.find((c) => c.subject.isEqual(cur!.issuer));
    if (!issuer || issuer === cur) break;
    walked.push(issuer);
    cur = issuer;
  }

  if (!matchedRoot) {
    return {
      success: false,
      chain,
      error: 'Chain validated but no matching ARCOTEL root found',
      warnings,
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
    };
  }

  // Throw on clear trust-anchor violations (belt-and-suspenders after pkijs verify)
  void VerificationError; // imported for future direct throws
  void ERR_CHAIN_FAIL;

  const successResult: PathResult = { success: true, chain, warnings };
  // Conditional spread for exactOptionalPropertyTypes
  if (matchedRoot !== undefined) successResult.matchedRoot = matchedRoot;
  return successResult;
}
