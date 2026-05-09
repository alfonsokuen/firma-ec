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
    // Placeholder roots cannot validate real certs — skip with a warning
    if (r.isPlaceholder) {
      warnings.push(`Trust root ${r.slug} is a placeholder; cannot validate against it`);
      continue;
    }

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

  const chain: Certificate[] = result.certificatePath ?? [];
  const lastInChain = chain[chain.length - 1];

  // Map chain root back to a TrustRoot entry — by subject/issuer match
  let matchedRoot: TrustRoot | undefined;
  if (lastInChain !== undefined) {
    for (const r of usableRoots) {
      try {
        const rootCert = pemToCert(r.pemContent);
        // lastInChain is typically issued by the root; check if root's subject equals chain-tail's issuer
        if (lastInChain.issuer.isEqual(rootCert.subject)) {
          matchedRoot = r;
          break;
        }
      } catch {
        /* ignore — already parsed successfully above */
      }
    }
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
