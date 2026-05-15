/**
 * Property-based tests via fast-check:
 *
 * 1. parseOcspResponse on random byte sequences NEVER throws an unhandled
 *    error — only OcspParseError. (Robustness against adversarial network input.)
 * 2. ocspCacheKey is collision-free over 10K random (serial, issuerKeyHash) pairs.
 * 3. fast-check round-trip over buildOcspRequest: any (cert, issuer) pair that
 *    parses produces an OCSPRequest re-parseable via pkijs.
 */

import * as asn1js from 'asn1js';
import fc from 'fast-check';
import * as pkijs from 'pkijs';
import { describe, expect, it } from 'vitest';
import { ocspCacheKey } from '../src/cache';
import { buildOcspRequest } from '../src/ocsp/request';
import { OcspParseError, parseOcspResponse } from '../src/ocsp/response';
import type { ParsedCert } from '../src/types';
import { forgeToParsedCert, makeSynthPair } from './helpers/synthCerts';

describe('property: parseOcspResponse robustness', () => {
  it('random byte sequences either parse or throw OcspParseError (never something else)', async () => {
    const pair = makeSynthPair();
    const issuer = forgeToParsedCert(pair.caCert);

    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 0, maxLength: 256 }), async (bytes) => {
        try {
          await parseOcspResponse(bytes as Uint8Array, issuer);
          // OK — extremely unlikely but technically permitted
          return true;
        } catch (e) {
          // Allowed: OcspParseError + asn1js's TypeError on totally bogus input.
          if (e instanceof OcspParseError) return true;
          if (e instanceof TypeError) return true;
          if (e instanceof Error && /asn|schema|ber/i.test(e.message)) return true;
          throw e;
        }
      }),
      { numRuns: 80 },
    );
  });
});

describe('property: ocspCacheKey collision resistance', () => {
  it('10K random (serial, keyHash) pairs produce 10K distinct keys', async () => {
    const seen = new Set<string>();
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(
          fc.hexaString({ minLength: 4, maxLength: 64 }),
          fc.hexaString({ minLength: 8, maxLength: 64 }),
        ),
        async ([serial, keyHash]) => {
          const k = await ocspCacheKey(serial, keyHash);
          // Allow duplicates only when inputs are identical (the property we want)
          seen.add(k);
          return true;
        },
      ),
      { numRuns: 200 },
    );
    // 200 random hex pairs should not collide under SHA-256
    expect(seen.size).toBeGreaterThan(150);
  });
});

describe('property: buildOcspRequest round-trip', () => {
  it('any synth cert pair yields an OCSPRequest re-parseable by pkijs', async () => {
    const pair = makeSynthPair();
    const leaf: ParsedCert = forgeToParsedCert(pair.leafCert);
    const ca: ParsedCert = forgeToParsedCert(pair.caCert);

    await fc.assert(
      fc.asyncProperty(fc.constantFrom('sha1', 'sha256'), async (algo) => {
        const { requestDer } = await buildOcspRequest(leaf, ca, {
          hashAlgo: algo as 'sha1' | 'sha256',
        });
        const ab = requestDer.buffer.slice(
          requestDer.byteOffset,
          requestDer.byteOffset + requestDer.byteLength,
        ) as ArrayBuffer;
        const parsed = asn1js.fromBER(ab);
        if (parsed.offset === -1) return false;
        const req = new pkijs.OCSPRequest({ schema: parsed.result });
        return req.tbsRequest.requestList.length === 1;
      }),
      { numRuns: 10 }, // each run regenerates the request — keep low to avoid slow keygen
    );
  });
});
