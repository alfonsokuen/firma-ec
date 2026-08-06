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
 * cert or no further bundled link is found.
 *
 * F1 (2026-08-05) — AIA fallback: when the bundle doesn't have the missing
 * intermediate, the walk tries `fetchIssuerCertViaAia` (RFC 5280 §4.2.2.1)
 * against the cert whose issuer is missing, BEFORE giving up. This is the
 * systemic fix for the pattern F0 patched by hand (UANATACA CA2-2021): a
 * static bundle can't cover every ACE forever, but a leaf's own AIA extension
 * always points at its actual issuer. Enabled by default (pass `aiaOpts:
 * null` as the 4th argument to disable — matches the pre-F1 no-network
 * behaviour byte for byte). Every AIA-resolved cert is cryptographically
 * verified by `fetchIssuerCertViaAia` itself before it reaches this file —
 * see its header in `@firma-ec/ltv-validation` for the trust boundary. A
 * cert resolved via AIA is embedded exactly like one resolved via the
 * bundle; it can never grant trust beyond what `validatePath` independently
 * decides at verification time.
 */

import { issuerInfo, resolveIssuerCert } from '@firma-ec/crypto-core';
import {
  ARCOTEL_PROXY_MAP,
  type AiaCertCache,
  type ParsedCert,
  type ProxyMap,
  fetchIssuerCertViaAia,
} from '@firma-ec/ltv-validation';
import { type TrustIntermediate, type TrustRoot, getIntermediates, getTrustRoots } from '@firma-ec/tsl-ec';
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

/** DN string for `missingIssuerDn` — UI messaging only, never a trust input. */
function formatIssuerDn(cert: Certificate): string {
  const info = issuerInfo(cert);
  return Object.entries(info.raw)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

const OID_CN = '2.5.4.3';

function certToParsedCert(cert: Certificate): ParsedCert {
  const cnTv = cert.subject.typesAndValues.find((tv) => tv.type === OID_CN);
  const cnValue = (cnTv?.value as { valueBlock?: { value?: string } } | undefined)?.valueBlock
    ?.value;
  return {
    subjectCN: typeof cnValue === 'string' ? cnValue : null,
    issuerCN: null,
    der: new Uint8Array(cert.toSchema().toBER(false)),
    notBefore: cert.notBefore.value,
    notAfter: cert.notAfter.value,
  };
}

/** F1 — options for the AIA caIssuers fallback. Pass `null` (as the 4th
 *  positional argument of {@link resolveSigningIntermediates}) to disable it
 *  entirely and keep the pre-F1 no-network behaviour. */
export interface ResolveSigningIntermediatesAiaOpts {
  fetchImpl?: typeof globalThis.fetch;
  /** Per-request timeout ms. Default 5000 (see aia-certs.ts — this is a
   *  never-critical fallback, not the signing critical path). */
  timeoutMs?: number;
  /** Same-origin proxy map. Defaults to ARCOTEL_PROXY_MAP; pass `null` to
   *  disable proxying (direct fetch) while keeping AIA itself enabled. */
  proxyMap?: ProxyMap | null;
  /** Optional in-memory cache shared across calls (see `createAiaCertCache`). */
  cache?: AiaCertCache;
  /**
   * 2026-08-05 HIGH-3 fix (independent code-reviewer pass on F1): absolute
   * epoch-ms deadline for the ENTIRE AIA walk below (up to 8 hops). Without
   * this, each hop got the full `timeoutMs` independently, so a slow-but-not-
   * quite-timing-out responder at every hop could consume 8× `timeoutMs` —
   * unbounded relative to the document's own signing timeout, reproducing
   * defect #1's failure mode (a hung network leg surfacing as a session-fatal
   * timeout instead of a reported degradation). Mirrors the `deadlineAt`
   * idiom already used for OCSP/CRL in `packages/signer/src/ltv.ts` and
   * `pades.ts`. Omitted ⇒ unbounded (pre-fix behaviour, still the default for
   * any caller that doesn't opt in).
   */
  deadlineAt?: number;
}

/**
 * Smallest per-hop timeout worth spending an AIA round trip on when an
 * aggregate deadline is in force. Mirrors `pades.ts`'s MIN_DEADLINE_LEG_MS /
 * `ltv.ts`'s MIN_LEG_TIMEOUT_MS: under this, a request can't even complete a
 * TLS handshake on a mobile network, so attempting it only burns what's left
 * of the caller's budget for no realistic chance of success.
 */
const MIN_AIA_LEG_TIMEOUT_MS = 250;

/**
 * `perRequestMs` clamped to the time left before `deadlineAt`; `null` when
 * there isn't enough left to be worth a request (caller should give up on
 * this hop, and thus the rest of the walk, without attempting it). No
 * deadline ⇒ unchanged value (previous, unbounded-per-hop behaviour).
 */
function clampAiaLegTimeout(perRequestMs: number, deadlineAt: number | undefined): number | null {
  if (deadlineAt === undefined) return perRequestMs;
  const left = deadlineAt - Date.now();
  if (left < MIN_AIA_LEG_TIMEOUT_MS) return null;
  return Math.min(perRequestMs, left);
}

export interface ResolveSigningIntermediatesResult {
  /** Existing intermediate DERs plus any resolved from the bundle and/or AIA. */
  ders: Uint8Array[];
  /** True iff the walk reached a self-signed root — the embedded chain is
   *  complete. False means at least one issuer in the middle could not be
   *  resolved from the bundle NOR via AIA (see `missingIssuerDn`). This is
   *  informational only: it does NOT gate signing (the signature still
   *  completes) and it is NOT a trust decision — `validatePath` is the only
   *  place that decides trust. */
  complete: boolean;
  /** Set when `complete` is false: DN of the issuer the walk could not find. */
  missingIssuerDn?: string;
}

/**
 * Given the signer leaf and the intermediates already present in the .p12,
 * return the full intermediate DER list to embed in the CMS — i.e. the existing
 * ones plus any bundled subordinate CAs (and, F1, any AIA-resolved cert)
 * needed to bridge the leaf toward its root.
 *
 * @param signerCertDer DER of the signing (leaf) certificate.
 * @param existingIntermediateDers Intermediate DERs already carried by the .p12.
 * @param bundle Subordinate-CA bundle; defaults to the @firma-ec/tsl-ec set.
 *   Tests / private CAs may pass their own.
 * @param aiaOpts F1 AIA fallback options. Omit/`undefined` for the default
 *   (enabled, ARCOTEL_PROXY_MAP, 5s timeout). Pass `null` to disable — the
 *   walk then behaves exactly as it did before F1.
 * @param roots Trust-anchor roots; defaults to the @firma-ec/tsl-ec set. Used
 *   ONLY to recognise "the walk has reached a known root, nothing left to
 *   bridge" — a root is NEVER embedded in the CMS (PAdES convention: ship the
 *   chain up to but excluding the trust anchor) and this parameter grants no
 *   trust of its own; `validatePath` at verification time is still the sole
 *   authority on which roots are actually trusted.
 */
export async function resolveSigningIntermediates(
  signerCertDer: Uint8Array,
  existingIntermediateDers: Uint8Array[],
  bundle?: TrustIntermediate[],
  aiaOpts: ResolveSigningIntermediatesAiaOpts | null = {},
  roots?: TrustRoot[],
): Promise<ResolveSigningIntermediatesResult> {
  let signerCert: Certificate;
  try {
    signerCert = derToCert(signerCertDer);
  } catch {
    // Can't parse the signer cert — leave the chain untouched. We can't
    // assess completeness either without a parseable leaf.
    return { ders: existingIntermediateDers, complete: false };
  }

  const list = bundle ?? (await getIntermediates());
  const rootList = roots ?? (await getTrustRoots());

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

  // Root certs, parsed ONLY to recognise "issuer is a known trust anchor" by
  // subject match — never embedded, never treated as a trust decision here.
  const rootCerts: Certificate[] = [];
  for (const r of rootList) {
    try {
      rootCerts.push(derToCert(pemToDer(r.pemContent)));
    } catch {
      /* skip unparseable */
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
  let reachedRoot = false;
  let missingIssuerDn: string | undefined;

  for (let depth = 0; depth < 8; depth++) {
    // Reached a self-signed cert (a root) — nothing more to add.
    if (current.subject.isEqual(current.issuer)) {
      reachedRoot = true;
      break;
    }
    // 2026-08-05 P0 fix: `getIntermediates()` never contains a root (roots
    // live in the separate `roots.ts` bundle this function used to never
    // consult), so the self-signed check above could never fire for a real
    // chain — every genuine signature came back `complete: false`. The chain
    // is equally complete once its next issuer IS a known trust anchor; the
    // root itself must NOT be embedded (PAdES convention — the verifier
    // already has it), so this is a stop condition, not a bridge to add.
    if (rootCerts.some((r) => r.subject.isEqual(current.issuer))) {
      reachedRoot = true;
      break;
    }
    // If the current cert's issuer is already in the pool, the link exists.
    const haveIssuer = poolCerts.some((c) => c.subject.isEqual(current.issuer));
    if (haveIssuer) {
      const next = poolCerts.find((c) => c.subject.isEqual(current.issuer));
      if (!next || next === current) {
        missingIssuerDn = formatIssuerDn(current);
        break;
      }
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
    if (matchCert) {
      const match = bundleCerts.find((bc) => bc.cert === matchCert);
      if (match) {
        out.push(match.der);
        poolCerts.push(match.cert);
        current = match.cert;
        continue;
      }
    }

    // F1 — bundle miss. Try the AIA caIssuers fallback before giving up.
    //
    // 2026-08-05 HIGH-3 fix: `hopTimeoutMs` is clamped to what's left of
    // `aiaOpts.deadlineAt` (when set) instead of always using the full
    // per-request `timeoutMs` — see `clampAiaLegTimeout`'s header. `null`
    // means the aggregate budget is already exhausted: skip the fetch
    // entirely (don't even attempt it) and give up on this hop exactly as
    // if the fetch itself had failed, so the rest of the walk's hops are
    // skipped too (each will clamp to the same exhausted deadline).
    if (aiaOpts !== null) {
      const hopTimeoutMs = clampAiaLegTimeout(aiaOpts.timeoutMs ?? 5000, aiaOpts.deadlineAt);
      const proxyMap =
        aiaOpts.proxyMap === null ? undefined : (aiaOpts.proxyMap ?? ARCOTEL_PROXY_MAP);
      const aiaResult =
        hopTimeoutMs === null
          ? ({ ok: false, reason: 'timeout' } as const)
          : await fetchIssuerCertViaAia(certToParsedCert(current), {
              ...(aiaOpts.fetchImpl ? { fetchImpl: aiaOpts.fetchImpl } : {}),
              timeoutMs: hopTimeoutMs,
              ...(proxyMap ? { proxyMap } : {}),
              ...(aiaOpts.cache ? { cache: aiaOpts.cache } : {}),
            });
      if (aiaResult.ok) {
        try {
          const aiaCert = derToCert(aiaResult.certDer);
          // 2026-08-05 HIGH fix (independent Fable review on the 2nd opus
          // review's own fix batch): a self-signed cert resolved via AIA was
          // embedded and the walk unconditionally set `reachedRoot = true`
          // on the NEXT iteration's self-signed check — regardless of
          // whether that root is one this app actually trusts. AIA can only
          // ever chain toward an ALREADY-trusted root (see the module
          // header's trust boundary); a self-signed cert that isn't in
          // `rootCerts` is an untrusted anchor the caller-supplied AIA
          // responder handed us, not a resolved issuer. Embedding it (a)
          // violates the PAdES convention this file documents elsewhere
          // ("the root itself must NOT be embedded") and (b) reported
          // `complete: true` for a chain that anchors nowhere this app
          // trusts — the exact false-negative F0/F1 exist to prevent, just
          // moved one hop later.
          if (aiaCert.subject.isEqual(aiaCert.issuer)) {
            if (rootCerts.some((r) => r.subject.isEqual(aiaCert.subject))) {
              reachedRoot = true;
              break;
            }
            missingIssuerDn = formatIssuerDn(current);
            break;
          }
          out.push(aiaResult.certDer);
          poolCerts.push(aiaCert);
          current = aiaCert;
          continue;
        } catch {
          /* malformed DER despite fetchIssuerCertViaAia's own parsing — fall
           * through to giving up below. */
        }
      }
    }

    missingIssuerDn = formatIssuerDn(current);
    break;
  }

  return reachedRoot
    ? { ders: out, complete: true }
    : { ders: out, complete: false, ...(missingIssuerDn !== undefined ? { missingIssuerDn } : {}) };
}
