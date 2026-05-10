import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fromBER } from 'asn1js';
import { Certificate } from 'pkijs';
import {
  getTsaTrustRoots,
  findTsaRootByIssuerCN,
  validateTsaCertChain,
  type ParsedCertLike,
} from '../src/index';
import { parseTimestampToken } from '../../tsa-client/src/parseToken';
import { parseTimeStampResp } from '../../tsa-client/src/response';

const FIXTURE_TSR = resolve(
  __dirname,
  '../../tsa-client/tests/__fixtures__/freetsa-kat-2026-05-09.tsr',
);
const HAS_KAT = existsSync(FIXTURE_TSR);

function derToCert(der: Uint8Array): ParsedCertLike {
  const ab = der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer;
  const asn = fromBER(ab);
  if (asn.offset === -1) throw new Error('cert decode failed');
  const cert = new Certificate({ schema: asn.result });
  return {
    certificate: cert,
    der,
    notBefore: cert.notBefore.value as Date,
    notAfter: cert.notAfter.value as Date,
  };
}

describe('getTsaTrustRoots', () => {
  it('returns 2 entries with FreeTSA real + ARCOTEL placeholder', () => {
    const roots = getTsaTrustRoots();
    expect(roots).toHaveLength(2);
    const slugs = roots.map((r) => r.slug).sort();
    expect(slugs).toEqual(['arcotel-placeholder', 'freetsa']);

    const freetsa = roots.find((r) => r.slug === 'freetsa')!;
    expect(freetsa.isPlaceholder).toBe(false);
    expect(freetsa.notBefore).toBeInstanceOf(Date);
    expect(freetsa.notAfter).toBeInstanceOf(Date);
    expect(freetsa.certDer.byteLength).toBeGreaterThan(0);

    const placeholder = roots.find((r) => r.slug === 'arcotel-placeholder')!;
    expect(placeholder.isPlaceholder).toBe(true);
  });

  it('caches the result across calls', () => {
    const a = getTsaTrustRoots();
    const b = getTsaTrustRoots();
    expect(a).toBe(b);
  });
});

describe('findTsaRootByIssuerCN', () => {
  it('returns the FreeTSA root when its CN matches', () => {
    const roots = getTsaTrustRoots();
    const freetsa = roots.find((r) => r.slug === 'freetsa')!;
    // Subject CN of FreeTSA root cert
    const subjectCN = (freetsa.certificate.subject.typesAndValues as unknown as { type: string; value: { valueBlock: { value: string } } }[])
      .find((tv) => tv.type === '2.5.4.3')?.value.valueBlock.value;
    expect(subjectCN).toBeTruthy();
    const match = findTsaRootByIssuerCN(subjectCN as string);
    expect(match?.slug).toBe('freetsa');
  });

  it('returns null when no root matches', () => {
    expect(findTsaRootByIssuerCN('nonexistent CN')).toBeNull();
  });
});

describe('validateTsaCertChain', () => {
  it.skipIf(!HAS_KAT)('validates the FreeTSA-issued TSA cert from the KAT fixture', async () => {
    const tsr = new Uint8Array(readFileSync(FIXTURE_TSR));
    const { token } = parseTimeStampResp(tsr);
    const parsed = parseTimestampToken(token);
    expect(parsed.tsaCertDers.length).toBeGreaterThanOrEqual(1);
    const tsaCert = derToCert(parsed.tsaCertDers[0]!);
    // Extra intermediates from token (skip the leaf)
    const intermediates = parsed.tsaCertDers.slice(1).map((d) => derToCert(d).certificate);
    const result = await validateTsaCertChain(tsaCert, intermediates);
    expect(result.ok).toBe(true);
    expect(result.matchedRoot?.slug).toBe('freetsa');
  });

  it('rejects with tsa_eku_missing when EKU is absent', async () => {
    // Use the FreeTSA root cert itself as the "TSA cert" — the root has no
    // id-kp-timeStamping EKU, so the check must fail early.
    const root = getTsaTrustRoots().find((r) => r.slug === 'freetsa')!;
    const result = await validateTsaCertChain(
      {
        certificate: root.certificate,
        der: root.certDer,
        notBefore: root.notBefore,
        notAfter: root.notAfter,
      },
      [],
    );
    expect(result).toMatchObject({ ok: false, reason: 'tsa_eku_missing' });
  });

  it.skipIf(!HAS_KAT)('rejects with reason:expired when atTime is past notAfter', async () => {
    const tsr = new Uint8Array(readFileSync(FIXTURE_TSR));
    const { token } = parseTimeStampResp(tsr);
    const parsed = parseTimestampToken(token);
    const tsaCert = derToCert(parsed.tsaCertDers[0]!);
    const future = new Date(tsaCert.notAfter.getTime() + 24 * 3600 * 1000);
    const result = await validateTsaCertChain(tsaCert, [], future);
    expect(result).toMatchObject({ ok: false, reason: 'expired' });
  });
});
