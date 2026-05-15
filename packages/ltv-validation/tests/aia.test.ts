import { describe, expect, it } from 'vitest';
import {
  extractCaIssuersUrls,
  extractCrlDistributionPoints,
  extractOcspUrls,
} from '../src/ocsp/aia';
import { forgeToParsedCert, makeSynthPair } from './helpers/synthCerts';

describe('AIA / CDP extraction', () => {
  it('extractOcspUrls returns [] when AIA absent', () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(pair.leafCert);
    expect(extractOcspUrls(leaf)).toEqual([]);
  });

  it('extractOcspUrls picks up OCSP URI from AIA', () => {
    const url = 'http://ocsp.example.com';
    const pair = makeSynthPair({ withAia: url });
    const leaf = forgeToParsedCert(pair.leafCert);
    const urls = extractOcspUrls(leaf);
    expect(urls).toContain(url);
  });

  it('extractCaIssuersUrls returns [] when AIA only has OCSP', () => {
    const pair = makeSynthPair({ withAia: 'http://ocsp.example.com' });
    const leaf = forgeToParsedCert(pair.leafCert);
    expect(extractCaIssuersUrls(leaf)).toEqual([]);
  });

  it('extractCrlDistributionPoints filters to http(s) URLs', () => {
    const pair = makeSynthPair({ withCdp: 'http://crl.example.com/ca.crl' });
    const leaf = forgeToParsedCert(pair.leafCert);
    const urls = extractCrlDistributionPoints(leaf);
    expect(urls).toEqual(['http://crl.example.com/ca.crl']);
  });

  it('extractCrlDistributionPoints returns [] when CDP extension absent', () => {
    const pair = makeSynthPair();
    const leaf = forgeToParsedCert(pair.leafCert);
    expect(extractCrlDistributionPoints(leaf)).toEqual([]);
  });
});
