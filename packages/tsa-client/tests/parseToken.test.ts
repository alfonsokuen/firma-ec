import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTimestampToken } from '../src/parseToken';
import { parseTimeStampResp } from '../src/response';

const FIXTURE_TSR = resolve(__dirname, '__fixtures__/freetsa-kat-2026-05-09.tsr');
const FIXTURE_META = resolve(__dirname, '__fixtures__/freetsa-kat-2026-05-09.meta.json');
const HAS_KAT = existsSync(FIXTURE_TSR) && existsSync(FIXTURE_META);

describe('parseTimestampToken (KAT)', () => {
  it.skipIf(!HAS_KAT)('extracts genTime, imprint, serial, TSA cert', () => {
    const tsr = new Uint8Array(readFileSync(FIXTURE_TSR));
    const meta = JSON.parse(readFileSync(FIXTURE_META, 'utf-8'));
    const { token } = parseTimeStampResp(tsr);
    const parsed = parseTimestampToken(token);

    expect(parsed.signingTime).toBeInstanceOf(Date);
    expect(parsed.imprint.length).toBe(32); // SHA-256
    expect(parsed.serialNumberHex.length).toBeGreaterThan(0);
    // FreeTSA SHA-256 hash algo OID
    expect(parsed.hashAlgoOid).toBe('2.16.840.1.101.3.4.2.1');
    expect(parsed.tsaCertDers.length).toBeGreaterThanOrEqual(1);
    // Imprint matches the captured plaintext SHA-256
    const hex = Array.from(parsed.imprint, (b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe(meta.imprintHex);
    // Inner SignerInfo signature is non-empty
    expect(parsed.innerSignatureValue.length).toBeGreaterThan(0);
    expect(parsed.innerSigAlgoOid.length).toBeGreaterThan(0);
    expect(parsed.innerDigestAlgoOid.length).toBeGreaterThan(0);
  });
});
