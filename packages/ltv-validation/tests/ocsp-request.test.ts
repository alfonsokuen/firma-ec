import { describe, it, expect } from 'vitest';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { buildOcspRequest } from '../src/ocsp/request';
import { makeSynthPair, forgeToParsedCert } from './helpers/synthCerts';

describe('buildOcspRequest', () => {
  it('produces a DER OCSPRequest with one CertID matching the leaf serial', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(pair.leafCert);
    const ca = forgeToParsedCert(pair.caCert);

    const { requestDer, nonce } = await buildOcspRequest(leaf, ca);
    expect(requestDer.length).toBeGreaterThan(20);
    expect(nonce).toBeNull(); // default: no nonce

    const ab = requestDer.buffer.slice(
      requestDer.byteOffset,
      requestDer.byteOffset + requestDer.byteLength,
    ) as ArrayBuffer;
    const parsed = asn1js.fromBER(ab);
    expect(parsed.offset).not.toBe(-1);
    const req = new pkijs.OCSPRequest({ schema: parsed.result });
    expect(req.tbsRequest.requestList).toHaveLength(1);
    const certID = req.tbsRequest.requestList[0]!.reqCert;
    // The serial in the request must match leaf cert serial 0x02ab
    const serialBuf = (certID.serialNumber.valueBlock as { valueHex: ArrayBuffer }).valueHex;
    const serialU = new Uint8Array(serialBuf);
    let serialHex = '';
    for (let i = 0; i < serialU.length; i++) {
      const b = serialU[i] ?? 0;
      serialHex += b.toString(16).padStart(2, '0');
    }
    // forge serializes "02ab" as INTEGER bytes 0x02 0xab (or with sign-bit pad).
    expect(serialHex.endsWith('02ab')).toBe(true);
  });

  it('sha1 vs sha256 produce different hashAlgorithm OIDs', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(pair.leafCert);
    const ca = forgeToParsedCert(pair.caCert);

    const { requestDer: derSha1 } = await buildOcspRequest(leaf, ca, { hashAlgo: 'sha1' });
    const { requestDer: derSha256 } = await buildOcspRequest(leaf, ca, { hashAlgo: 'sha256' });

    expect(derSha1).not.toEqual(derSha256);

    // Decode and check OIDs
    const sha1Algo = new pkijs.OCSPRequest({
      schema: asn1js.fromBER(
        derSha1.buffer.slice(derSha1.byteOffset, derSha1.byteOffset + derSha1.byteLength) as ArrayBuffer,
      ).result,
    }).tbsRequest.requestList[0]!.reqCert.hashAlgorithm.algorithmId;
    expect(sha1Algo).toBe('1.3.14.3.2.26'); // SHA-1

    const sha256Algo = new pkijs.OCSPRequest({
      schema: asn1js.fromBER(
        derSha256.buffer.slice(derSha256.byteOffset, derSha256.byteOffset + derSha256.byteLength) as ArrayBuffer,
      ).result,
    }).tbsRequest.requestList[0]!.reqCert.hashAlgorithm.algorithmId;
    expect(sha256Algo).toBe('2.16.840.1.101.3.4.2.1');
  });

  it('nonce: true adds an OCSP nonce extension and surfaces the bytes', async () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(pair.leafCert);
    const ca = forgeToParsedCert(pair.caCert);

    const { requestDer, nonce } = await buildOcspRequest(leaf, ca, { nonce: true });
    expect(nonce).not.toBeNull();
    expect(nonce!.byteLength).toBe(16);

    const parsed = new pkijs.OCSPRequest({
      schema: asn1js.fromBER(
        requestDer.buffer.slice(requestDer.byteOffset, requestDer.byteOffset + requestDer.byteLength) as ArrayBuffer,
      ).result,
    });
    const exts = parsed.tbsRequest.requestExtensions ?? [];
    const nonceExt = exts.find((e) => e.extnID === '1.3.6.1.5.5.7.48.1.2');
    expect(nonceExt).toBeDefined();
  });
});
