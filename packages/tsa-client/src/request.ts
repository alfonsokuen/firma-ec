/**
 * Build + POST RFC 3161 TimeStampReq.
 *
 * Browser-compatible: uses globalThis.fetch + asn1js + pkijs only.
 */

import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import type { HashAlgo } from './types';

const HASH_OID: Record<HashAlgo, string> = {
  'SHA-256': '2.16.840.1.101.3.4.2.1',
  'SHA-384': '2.16.840.1.101.3.4.2.2',
};

const MAX_RESPONSE_BYTES = 32 * 1024; // 32 KB cap (spec §3.2 / threat F6-8).

export interface TsClientErrorShape {
  code?: 'rate_limited' | 'malformed' | 'network' | 'rejected';
  detail?: string;
}

function err(message: string, code: NonNullable<TsClientErrorShape['code']>, detail?: string): Error & TsClientErrorShape {
  const e = new Error(message) as Error & TsClientErrorShape;
  e.code = code;
  if (detail !== undefined) e.detail = detail;
  return e;
}

/**
 * Build a TimeStampReq DER per RFC 3161.
 *
 * @param imprint - hash bytes of the data being timestamped (raw, not OctetString-wrapped)
 * @param hashAlgo - 'SHA-256' or 'SHA-384'
 * @param nonce - random bytes for replay defense (typically 8 bytes)
 * @returns DER-encoded TimeStampReq
 */
export function buildTimeStampReq(
  imprint: Uint8Array,
  hashAlgo: HashAlgo,
  nonce: Uint8Array,
): Uint8Array {
  const oid = HASH_OID[hashAlgo];
  if (!oid) throw new Error(`unsupported hash algo: ${hashAlgo}`);

  const imprintAb = imprint.buffer.slice(imprint.byteOffset, imprint.byteOffset + imprint.byteLength) as ArrayBuffer;
  const nonceAb = nonce.buffer.slice(nonce.byteOffset, nonce.byteOffset + nonce.byteLength) as ArrayBuffer;

  // pkijs's TimeStampReq class is available in pkijs ≥3.2.
  const tsq = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: oid }),
      hashedMessage: new asn1js.OctetString({ valueHex: imprintAb }),
    }),
    nonce: new asn1js.Integer({ valueHex: nonceAb }),
    certReq: true,
  });

  const der = tsq.toSchema().toBER(false);
  return new Uint8Array(der);
}

/**
 * POST a DER-encoded TimeStampReq to the TSA URL and return the response body.
 *
 * Throws errors with `code` discriminators:
 *   - 'rate_limited' on HTTP 429
 *   - 'malformed' if response exceeds {@link MAX_RESPONSE_BYTES}
 *   - 'network' on any other non-2xx or fetch failure
 *
 * AbortSignal cancellation surfaces as the native AbortError/TimeoutError.
 */
export async function postTimeStampReq(
  url: string,
  tsqDer: Uint8Array,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!/^https:\/\//i.test(url)) {
    throw err('TSA URL must be https://', 'malformed', 'tsa url must be https');
  }

  let resp: Response;
  try {
    resp = await globalThis.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/timestamp-query',
        Accept: 'application/timestamp-reply',
      },
      body: tsqDer as BodyInit,
      signal,
    });
  } catch (e) {
    // Re-throw AbortError/TimeoutError so the orchestrator can map them to 'timeout'.
    const name = (e as { name?: string })?.name;
    if (name === 'AbortError' || name === 'TimeoutError') throw e;
    throw err(`fetch failed: ${(e as Error).message ?? String(e)}`, 'network', (e as Error).message);
  }

  if (resp.status === 429) {
    throw err('TSA rate limited', 'rate_limited', `HTTP 429 ${resp.statusText}`);
  }
  if (!resp.ok) {
    throw err(`TSA HTTP ${resp.status}`, 'network', `${resp.status} ${resp.statusText}`);
  }

  // Cheap pre-check: Content-Length header (when present) reveals oversize before we read.
  const cl = resp.headers.get('content-length');
  if (cl !== null) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > MAX_RESPONSE_BYTES) {
      throw err('response too large', 'malformed', 'response too large');
    }
  }

  let buf: ArrayBuffer;
  try {
    buf = await resp.arrayBuffer();
  } catch (e) {
    throw err(`read body failed: ${(e as Error).message ?? String(e)}`, 'network');
  }
  if (buf.byteLength > MAX_RESPONSE_BYTES) {
    throw err('response too large', 'malformed', 'response too large');
  }
  return new Uint8Array(buf);
}
