/**
 * chainIntermediates.ts — Embed the missing subordinate-CA intermediate(s)
 * into a signature's CMS when the signer's .p12 ships leaf-only.
 *
 * WHY
 * ---
 * Many ACEs (e.g. UANATACA) issue end-entity certs from a subordinate CA, yet
 * ship .p12 files that contain ONLY the leaf. A PAdES CMS built from such a
 * .p12 embeds only the leaf, so a client-side / offline verifier cannot bridge
 * leaf → intermediate → trusted root and wrongly reports "issuer not recognised
 * in Ecuador". Embedding the intermediate(s) makes the produced PDF
 * self-contained — it then validates in firmar.ec AND in Adobe.
 *
 * This walks from the signer cert's issuer upward, pulling matching subordinate
 * CAs from the @firma-ec/tsl-ec bundle until the chain reaches a self-signed
 * cert or no further bundled link is found. It never fetches from the network
 * and never alters the leaf or the private key.
 */

import { resolveIssuerCert } from '@firma-ec/crypto-core';
import { type TrustIntermediate, getIntermediates } from '@firma-ec/tsl-ec';
import { fromBER } from 'asn1js';
import { Certificate } from 'pkijs';

function toAb(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function derToCert(der: Uint8Array): Certificate {
  const asn = fromBER(toAb(der));
  if (asn.offset === -1) throw new Error('DER ASN.1 decode failed');
  return new Certificate({ schema: asn.result });
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----BEGIN [A-Z ]+-----|-----END [A-Z ]+-----|\s/g, '');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Given the signer leaf and the intermediates already present in the .p12,
 * return the full intermediate DER list to embed in the CMS — i.e. the existing
 * ones plus any bundled subordinate CAs needed to bridge the leaf toward its
 * root.
 *
 * @param signerCertDer DER of the signing (leaf) certificate.
 * @param existingIntermediateDers Intermediate DERs already carried by the .p12.
 * @param bundle Subordinate-CA bundle; defaults to the @firma-ec/tsl-ec set.
 *   Tests / private CAs may pass their own.
 */
export async function resolveSigningIntermediates(
  signerCertDer: Uint8Array,
  existingIntermediateDers: Uint8Array[],
  bundle?: TrustIntermediate[],
): Promise<Uint8Array[]> {
  let signerCert: Certificate;
  try {
    signerCert = derToCert(signerCertDer);
  } catch {
    // Can't parse the signer cert — leave the chain untouched.
    return existingIntermediateDers;
  }

  const list = bundle ?? (await getIntermediates());
  if (list.length === 0) return existingIntermediateDers;

  // Parse the bundle once (skip anything unparseable).
  const bundleCerts: { cert: Certificate; der: Uint8Array }[] = [];
  for (const it of list) {
    try {
      const der = pemToDer(it.pemContent);
      bundleCerts.push({ cert: derToCert(der), der });
    } catch {
      /* skip */
    }
  }

  // Pool of certs already in the chain (leaf + existing intermediates) so we
  // don't re-add one the .p12 already supplied.
  const poolCerts: Certificate[] = [signerCert];
  for (const der of existingIntermediateDers) {
    try {
      poolCerts.push(derToCert(der));
    } catch {
      /* skip */
    }
  }

  const out = [...existingIntermediateDers];
  let current = signerCert;
  for (let depth = 0; depth < 8; depth++) {
    // Reached a self-signed cert (a root) — nothing more to add.
    if (current.subject.isEqual(current.issuer)) break;
    // If the current cert's issuer is already in the pool, the link exists.
    const haveIssuer = poolCerts.some((c) => c.subject.isEqual(current.issuer));
    if (haveIssuer) {
      const next = poolCerts.find((c) => c.subject.isEqual(current.issuer));
      if (!next || next === current) break;
      current = next;
      continue;
    }
    // Find a bundled subordinate CA whose subject matches the missing issuer.
    // 2026-08-05 HIGH fix: several bundled intermediates can share the same
    // subject DN (e.g. BCE's 2011/2019 subCA renewal) — a plain `.find()`
    // picked whichever was declared first, embedding the WRONG intermediate
    // into the CMS regardless of which one actually issued `current`. See
    // resolveIssuerCert's doc in crypto-core for the AKI/SKI-first, real
    // signature-verification-fallback resolution strategy.
    const matchCert = await resolveIssuerCert(
      current,
      bundleCerts.map((bc) => bc.cert),
    );
    if (!matchCert) break;
    const match = bundleCerts.find((bc) => bc.cert === matchCert);
    if (!match) break;
    out.push(match.der);
    poolCerts.push(match.cert);
    current = match.cert;
  }

  return out;
}
