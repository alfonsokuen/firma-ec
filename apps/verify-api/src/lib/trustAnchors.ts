/**
 * How many trust anchors are actually USABLE.
 *
 * The naive check — `(await getTrustRoots()).length` — is worthless, and
 * dangerously so: that array is a structural constant (29 literal entries), so
 * it reads 29 even if every PEM inside is empty or corrupt. A health probe
 * built on it reports green while the service marks legitimate Ecuadorian
 * signatures as untrusted, because the code that decides trust
 * (`packages/verifier/src/pathValidation.ts`) applies a much stricter filter:
 * placeholders are skipped, PEMs that fail to parse are skipped, and — the one
 * that matters most — a root whose SHA-256 fingerprint does not match what the
 * TSL claims is REFUSED, to prevent silent certificate substitution.
 *
 * This module applies the same three rules, so the probe answers the question
 * an operator actually cares about: "would a valid signature be trusted right
 * now?" Any drop below the declared count is a real degradation and must be
 * loud, because its symptom (false "untrusted") is indistinguishable from a
 * genuinely bad document.
 */
import { digest, toHex } from '@firma-ec/crypto-core';
import { type TrustRoot, getTrustRoots } from '@firma-ec/tsl-ec';
import { fromBER } from 'asn1js';
import { Certificate } from 'pkijs';

export interface AnchorReport {
  /** Non-placeholder roots the TSL declares. */
  declared: number;
  /** Roots that parse AND whose fingerprint matches. These are the real ones. */
  usable: number;
  /** One line per rejected anchor, for the log. Never sent to a caller. */
  problems: string[];
}

function pemToCert(pem: string): Certificate {
  const b64 = pem.replace(/-----BEGIN [A-Z ]+-----|-----END [A-Z ]+-----|\s/g, '');
  const der = Uint8Array.from(Buffer.from(b64, 'base64'));
  const asn = fromBER(
    der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer,
  );
  if (asn.offset === -1) throw new Error('PEM ASN.1 decode failed');
  return new Certificate({ schema: asn.result });
}

export async function inspectTrustAnchors(roots?: TrustRoot[]): Promise<AnchorReport> {
  const all = roots ?? (await getTrustRoots());
  const real = all.filter((r) => !r.isPlaceholder);
  const problems: string[] = [];
  let usable = 0;

  for (const root of real) {
    try {
      const cert = pemToCert(root.pemContent);
      const der = new Uint8Array(cert.toSchema().toBER(false));
      const fingerprint = toHex(await digest('SHA-256', der));
      if (fingerprint !== root.fingerprintSha256) {
        problems.push(`${root.slug}: fingerprint mismatch`);
        continue;
      }
      usable += 1;
    } catch (err) {
      problems.push(`${root.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { declared: real.length, usable, problems };
}
