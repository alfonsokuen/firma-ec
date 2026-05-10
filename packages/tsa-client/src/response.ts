/**
 * Parse + validate RFC 3161 TimeStampResp DER.
 *
 * Returns the inner TimeStampToken bytes (a CMS ContentInfo of SignedData).
 * Imprint + nonce match are validated against the original request.
 */

import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { parseTimestampToken } from './parseToken';

interface TsClientErrorShape {
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
 * Parse a DER-encoded TimeStampResp.
 *
 * Returns:
 *   - statusOk: true when PKIStatus is granted (0) or grantedWithMods (1).
 *   - token: the TimeStampToken bytes (DER of ContentInfo) when present.
 *   - statusString: when status indicates rejection, joins the optional statusString[].
 *
 * Throws an Error with `code:'malformed'` on any parse failure.
 * Throws with `code:'rejected'` only when status > 1 *and* no token is present.
 */
export function parseTimeStampResp(tsrDer: Uint8Array): {
  token: Uint8Array;
  statusOk: boolean;
  statusString?: string;
} {
  const ab = tsrDer.buffer.slice(tsrDer.byteOffset, tsrDer.byteOffset + tsrDer.byteLength) as ArrayBuffer;
  const parsed = asn1js.fromBER(ab);
  if (parsed.offset === -1) throw err('TimeStampResp ASN.1 decode failed', 'malformed', 'asn1 decode');

  let resp: pkijs.TimeStampResp;
  try {
    resp = new pkijs.TimeStampResp({ schema: parsed.result });
  } catch (e) {
    throw err(`TimeStampResp parse failed: ${(e as Error).message}`, 'malformed', 'pkijs TimeStampResp');
  }

  // resp.status is a PKIStatusInfo: { status: number, statusString?: Utf8String[], failInfo?: BitString }
  const statusInfo = resp.status as unknown as {
    status: number;
    statusString?: { valueBlock: { value: string } }[];
  };
  const statusNum = Number(statusInfo.status);
  const statusOk = statusNum === 0 || statusNum === 1;

  let statusString: string | undefined;
  if (Array.isArray(statusInfo.statusString) && statusInfo.statusString.length > 0) {
    statusString = statusInfo.statusString.map((s) => s.valueBlock?.value ?? '').join('; ');
  }

  const tst = (resp as unknown as { timeStampToken?: { toSchema: () => { toBER: (sized: boolean) => ArrayBuffer } } }).timeStampToken;
  if (!tst) {
    if (!statusOk) {
      throw err('TSA rejected', 'rejected', statusString ?? `status=${statusNum}`);
    }
    throw err('granted but no token', 'malformed', 'no timeStampToken');
  }

  const tokenBer = tst.toSchema().toBER(false);
  const token = new Uint8Array(tokenBer);
  return statusString !== undefined ? { token, statusOk, statusString } : { token, statusOk };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/**
 * Validate a parsed TimeStampToken's messageImprint (and nonce, if non-empty)
 * against the values from the original request.
 *
 * Constant-time comparison for the imprint to avoid timing leaks.
 */
export function verifyResponseAgainstRequest(
  token: Uint8Array,
  expectedImprint: Uint8Array,
  expectedNonce: Uint8Array,
): { ok: true } | { ok: false; reason: 'imprint_mismatch' | 'nonce_mismatch' | 'parse_failed' } {
  let parsed;
  try {
    parsed = parseTimestampToken(token);
  } catch {
    return { ok: false, reason: 'parse_failed' };
  }
  if (!bytesEqual(parsed.imprint, expectedImprint)) {
    return { ok: false, reason: 'imprint_mismatch' };
  }
  if (parsed.nonce && parsed.nonce.length > 0) {
    // Some TSAs strip leading zero bytes from INTEGER encodings; compare allowing a
    // left-zero-padded match in either direction.
    const a = stripLeadingZero(expectedNonce);
    const b = stripLeadingZero(parsed.nonce);
    if (!bytesEqual(a, b)) return { ok: false, reason: 'nonce_mismatch' };
  }
  return { ok: true };
}

function stripLeadingZero(b: Uint8Array): Uint8Array {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  return b.subarray(i);
}
