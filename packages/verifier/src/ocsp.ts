import { fromBER } from 'asn1js';
import { BasicOCSPResponse, OCSPRequest, OCSPResponse } from 'pkijs';
import type { Certificate } from 'pkijs';
import type { OcspStatus } from './result';

const OCSP_PROXY_BASE = 'https://ocsp.firmar.ec';

/** Build an OCSPRequest for `subjectCert` issued by `issuerCert` using the pkijs createForCertificate API. */
async function buildRequest(
  subjectCert: Certificate,
  issuerCert: Certificate,
): Promise<Uint8Array> {
  const req = new OCSPRequest();
  await req.createForCertificate(subjectCert, {
    issuerCertificate: issuerCert,
    hashAlgorithm: 'SHA-1',
  });
  return new Uint8Array(req.toSchema(true).toBER(false));
}

/** Send an OCSP request via the firmar.ec CF Worker proxy. */
async function postViaProxy(
  slug: string,
  reqBytes: Uint8Array,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const url = `${OCSP_PROXY_BASE}/${slug}`;
  const body = reqBytes.buffer.slice(
    reqBytes.byteOffset,
    reqBytes.byteOffset + reqBytes.byteLength,
  ) as ArrayBuffer;
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/ocsp-request' },
    body,
  };
  // exactOptionalPropertyTypes: signal must be null not undefined when absent
  if (signal !== undefined) init.signal = signal;
  const resp = await fetch(url, init);
  if (!resp.ok) throw new Error(`OCSP proxy ${slug} returned ${resp.status}`);
  const ab = await resp.arrayBuffer();
  return new Uint8Array(ab);
}

function parseResponse(respBytes: Uint8Array): {
  status: OcspStatus['status'];
  revokedAt?: Date;
  reason?: string;
} {
  const asn = fromBER(
    respBytes.buffer.slice(
      respBytes.byteOffset,
      respBytes.byteOffset + respBytes.byteLength,
    ) as ArrayBuffer,
  );
  if (asn.offset === -1) throw new Error('OCSP response ASN.1 decode failed');
  const ocspResp = new OCSPResponse({ schema: asn.result });

  const status = ocspResp.responseStatus.valueBlock.valueDec;
  if (status !== 0) {
    // 0 = successful
    throw new Error(`OCSP responseStatus = ${status} (non-success)`);
  }

  const responseBytes = ocspResp.responseBytes;
  if (!responseBytes) throw new Error('OCSP responseBytes missing');

  if (responseBytes.responseType !== '1.3.6.1.5.5.7.48.1.1') {
    throw new Error(`Unexpected OCSP responseType ${responseBytes.responseType}`);
  }

  const basicAsn = fromBER(responseBytes.response.valueBlock.valueHex as ArrayBuffer);
  const basic = new BasicOCSPResponse({ schema: basicAsn.result });

  const single = basic.tbsResponseData.responses[0];
  if (!single) throw new Error('OCSP response has no SingleResponse entries');

  // certStatus is typed `any` by pkijs — discriminate by ASN.1 tag number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const certStatus = single.certStatus as any;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (certStatus.idBlock?.tagNumber === 0) {
    // good (0) — IMPLICIT NULL
    return { status: 'good' };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (certStatus.idBlock?.tagNumber === 1) {
    // revoked (1) — has revocationTime + optional revocationReason
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const revokedAt = certStatus.revocationTime?.value as Date | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const reasonCode = certStatus.revocationReason?.valueBlock?.valueDec as number | undefined;
    const REASONS = [
      'unspecified',
      'keyCompromise',
      'cACompromise',
      'affiliationChanged',
      'superseded',
      'cessationOfOperation',
      'certificateHold',
      '',
      'removeFromCRL',
      'privilegeWithdrawn',
      'aACompromise',
    ];
    const result: { status: OcspStatus['status']; revokedAt?: Date; reason?: string } = {
      status: 'revoked',
    };
    if (revokedAt !== undefined) result.revokedAt = revokedAt;
    if (reasonCode !== undefined) result.reason = REASONS[reasonCode] ?? 'unspecified';
    return result;
  }

  return { status: 'unknown' };
}

export interface OcspContext {
  signerCert: Certificate;
  issuerCert: Certificate;
  /** ARCOTEL slug to find the right responder via the proxy */
  acSlug: string;
}

export async function checkOcsp(
  ctx: OcspContext,
  opts: { fetchTimeoutMs?: number } = {},
): Promise<OcspStatus> {
  const checkedAt = new Date().toISOString();
  const timeoutMs = opts.fetchTimeoutMs ?? 6000;
  try {
    const reqBytes = await buildRequest(ctx.signerCert, ctx.issuerCert);
    const ac = new AbortController();
    // v0.7.31 — Hard deadline via Promise.race. AbortController alone is NOT
    // sufficient: on some mobile networks (observed on Android Chrome
    // 2026-05-20) a fetch stuck in DNS/TLS connection setup does not reject
    // when `ac.abort()` fires, so `await postViaProxy(...)` never settles and
    // the whole verification hangs (the worker posts no further progress and
    // only the bus.ts watchdog eventually trips at 30s). Racing the fetch
    // against a timer that REJECTS guarantees checkOcsp settles within
    // `timeoutMs` regardless of the underlying fetch's behaviour. We still call
    // ac.abort() to free the socket where the browser honours it.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, rej) => {
      timer = setTimeout(() => {
        ac.abort();
        rej(new Error(`OCSP timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    let respBytes: Uint8Array;
    try {
      respBytes = await Promise.race([postViaProxy(ctx.acSlug, reqBytes, ac.signal), deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    const parsed = parseResponse(respBytes);
    const ocspResult: OcspStatus = {
      status: parsed.status,
      checkedAt,
      source: 'live',
    };
    if (parsed.revokedAt !== undefined) ocspResult.revokedAt = parsed.revokedAt.toISOString();
    if (parsed.reason !== undefined) ocspResult.reason = parsed.reason;
    return ocspResult;
  } catch (e) {
    return {
      status: 'not_checked',
      checkedAt,
      source: 'none',
      reason: `OCSP fetch failed: ${(e as Error).message}`,
    };
  }
}
