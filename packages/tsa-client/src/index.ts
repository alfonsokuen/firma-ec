/**
 * @firma-ec/tsa-client — RFC 3161 Time-Stamp Protocol client.
 *
 * Public API: requestTimestamp() orchestrates build → POST → parse → verify.
 * Browser-compatible (uses globalThis.fetch + globalThis.crypto). No node:* imports.
 */

export type {
  HashAlgo,
  ParsedCert,
  ParsedTimestampToken,
  RequestTimestampOpts,
  TimestampError,
  TimestampOk,
  TimestampResult,
} from './types';

export { buildTimeStampReq, postTimeStampReq } from './request';
export { parseTimeStampResp, verifyResponseAgainstRequest } from './response';
export { parseTimestampToken } from './parseToken';

import { parseCertFromDer } from './cert';
import { parseTimestampToken } from './parseToken';
import { buildTimeStampReq, postTimeStampReq } from './request';
import { parseTimeStampResp, verifyResponseAgainstRequest } from './response';
import type { RequestTimestampOpts, TimestampResult } from './types';

const DEFAULT_TSA_URL = 'https://freetsa.org/tsr';
const DEFAULT_TIMEOUT_MS = 8000;

interface TsClientError extends Error {
  code?: 'rate_limited' | 'malformed' | 'network' | 'rejected';
  detail?: string;
}

/**
 * Request an RFC 3161 timestamp for the given message imprint.
 *
 * Generates a random 8-byte nonce, builds a TimeStampReq, POSTs to the TSA,
 * parses + validates the response (status, imprint match, nonce match), and
 * returns either a TimestampOk (with parsed token) or a TimestampError.
 *
 * Never throws — all error conditions are returned as discriminated unions.
 */
export async function requestTimestamp(
  messageImprint: Uint8Array,
  opts: RequestTimestampOpts = {},
): Promise<TimestampResult> {
  const url = opts.url ?? DEFAULT_TSA_URL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const hashAlgo = opts.hashAlgo ?? 'SHA-256';

  // Generate nonce (8 bytes — RFC 3161 §2.4.1 nonce is INTEGER of variable length).
  const nonce = new Uint8Array(8);
  globalThis.crypto.getRandomValues(nonce);

  const signal = opts.signal ?? AbortSignal.timeout(timeoutMs);

  let tsqDer: Uint8Array;
  try {
    tsqDer = buildTimeStampReq(messageImprint, hashAlgo, nonce);
  } catch (e) {
    return { error: 'malformed', detail: `build: ${(e as Error).message ?? String(e)}` };
  }

  let tsrDer: Uint8Array;
  try {
    tsrDer = await postTimeStampReq(url, tsqDer, signal);
  } catch (e) {
    const err = e as TsClientError;
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return { error: 'timeout', detail: err.message };
    }
    if (err?.code === 'rate_limited')
      return { error: 'rate_limited', ...(err.detail ? { detail: err.detail } : {}) };
    if (err?.code === 'malformed')
      return { error: 'malformed', ...(err.detail ? { detail: err.detail } : {}) };
    return { error: 'network', detail: err?.detail ?? err?.message ?? String(err) };
  }

  let parsed: { token: Uint8Array; statusOk: boolean; statusString?: string };
  try {
    parsed = parseTimeStampResp(tsrDer);
  } catch (e) {
    const err = e as TsClientError;
    if (err?.code === 'rejected') return { error: 'rejected', detail: err.detail ?? 'rejected' };
    return { error: 'malformed', detail: err?.detail ?? err?.message ?? String(err) };
  }
  if (!parsed.statusOk) {
    return { error: 'rejected', detail: parsed.statusString ?? 'status not granted' };
  }

  const verified = verifyResponseAgainstRequest(parsed.token, messageImprint, nonce);
  if (!verified.ok) {
    return { error: 'malformed', detail: verified.reason };
  }

  let tokenInfo;
  try {
    tokenInfo = parseTimestampToken(parsed.token);
  } catch (e) {
    return { error: 'malformed', detail: `parseToken: ${(e as Error).message ?? String(e)}` };
  }

  if (tokenInfo.tsaCertDers.length === 0) {
    return { error: 'malformed', detail: 'no TSA cert in token' };
  }

  let tsaCert;
  try {
    tsaCert = parseCertFromDer(tokenInfo.tsaCertDers[0]!);
  } catch (e) {
    return { error: 'malformed', detail: `tsaCert: ${(e as Error).message ?? String(e)}` };
  }

  return {
    token: parsed.token,
    tsaUrl: url,
    hashAlgo,
    signingTime: tokenInfo.signingTime,
    tsaCert,
    serialNumberHex: tokenInfo.serialNumberHex,
  };
}
