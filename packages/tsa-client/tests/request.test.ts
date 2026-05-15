import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTimeStampReq, postTimeStampReq } from '../src/request';

const SHA256_OID = '2.16.840.1.101.3.4.2.1';
const SHA384_OID = '2.16.840.1.101.3.4.2.2';

function makeImprint(byteLen = 32): Uint8Array {
  const out = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) out[i] = (i * 7 + 3) & 0xff;
  return out;
}

describe('buildTimeStampReq', () => {
  it('produces DER that parses as a TimeStampReq with matching imprint', () => {
    const imprint = makeImprint();
    const nonce = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const der = buildTimeStampReq(imprint, 'SHA-256', nonce);
    expect(der.byteLength).toBeGreaterThan(0);

    const ab = der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer;
    const parsed = asn1js.fromBER(ab);
    expect(parsed.offset).not.toBe(-1);
    const tsq = new pkijs.TimeStampReq({ schema: parsed.result });

    expect(tsq.version).toBe(1);
    const algoOid = (tsq.messageImprint.hashAlgorithm as unknown as { algorithmId: string })
      .algorithmId;
    expect(algoOid).toBe(SHA256_OID);
    const hashed = tsq.messageImprint.hashedMessage as unknown as {
      valueBlock: { valueHexView?: Uint8Array; valueHex?: ArrayBuffer };
    };
    const view =
      hashed.valueBlock.valueHexView ?? new Uint8Array(hashed.valueBlock.valueHex as ArrayBuffer);
    expect(Array.from(view)).toEqual(Array.from(imprint));
    expect((tsq as unknown as { certReq: boolean }).certReq).toBe(true);
  });

  it('honours SHA-384 hashAlgo selection', () => {
    const imprint = makeImprint(48);
    const der = buildTimeStampReq(imprint, 'SHA-384', new Uint8Array(8));
    const ab = der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer;
    const parsed = asn1js.fromBER(ab);
    const tsq = new pkijs.TimeStampReq({ schema: parsed.result });
    const algoOid = (tsq.messageImprint.hashAlgorithm as unknown as { algorithmId: string })
      .algorithmId;
    expect(algoOid).toBe(SHA384_OID);
  });
});

describe('postTimeStampReq', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws code:rate_limited on HTTP 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }),
      ),
    );
    await expect(
      postTimeStampReq(
        'https://freetsa.org/tsr',
        new Uint8Array([1, 2, 3]),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('throws code:network on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream', { status: 502, statusText: 'Bad Gateway' })),
    );
    await expect(
      postTimeStampReq(
        'https://freetsa.org/tsr',
        new Uint8Array([1, 2, 3]),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'network' });
  });

  it('throws code:malformed when response exceeds size cap', async () => {
    const huge = new Uint8Array(40 * 1024);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(huge, {
            status: 200,
            headers: { 'content-length': String(huge.byteLength) },
          }),
      ),
    );
    await expect(
      postTimeStampReq(
        'https://freetsa.org/tsr',
        new Uint8Array([1, 2, 3]),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'malformed' });
  });

  it('rejects non-https URLs', async () => {
    await expect(
      postTimeStampReq(
        'http://insecure.example/tsr',
        new Uint8Array([1]),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'malformed' });
  });

  it('returns body bytes on 200', async () => {
    const body = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/timestamp-reply' },
          }),
      ),
    );
    const out = await postTimeStampReq(
      'https://freetsa.org/tsr',
      new Uint8Array([1]),
      new AbortController().signal,
    );
    expect(Array.from(out)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });
});
