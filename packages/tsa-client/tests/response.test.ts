import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTimeStampResp, verifyResponseAgainstRequest } from '../src/response';

const FIXTURE_TSR = resolve(__dirname, '__fixtures__/freetsa-kat-2026-05-09.tsr');
const FIXTURE_META = resolve(__dirname, '__fixtures__/freetsa-kat-2026-05-09.meta.json');
const HAS_KAT = existsSync(FIXTURE_TSR) && existsSync(FIXTURE_META);

interface KatMeta {
  imprintHex: string;
  nonceHex: string;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

describe('parseTimeStampResp (KAT)', () => {
  it.skipIf(!HAS_KAT)('parses captured FreeTSA fixture, returns granted token', () => {
    const tsr = new Uint8Array(readFileSync(FIXTURE_TSR));
    const out = parseTimeStampResp(tsr);
    expect(out.statusOk).toBe(true);
    expect(out.token.byteLength).toBeGreaterThan(0);
  });

  it.skipIf(!HAS_KAT)('rejects when status field is corrupted', () => {
    const tsr = new Uint8Array(readFileSync(FIXTURE_TSR));
    // The PKIStatus INTEGER encoding for 0 (granted) is `02 01 00`. Find the
    // SEQUENCE containing PKIStatusInfo and flip the status byte to 2 (rejection).
    const copy = new Uint8Array(tsr);
    // The first INTEGER 0 in a granted response is the PKIStatus.
    for (let i = 0; i < copy.length - 2; i++) {
      if (copy[i] === 0x02 && copy[i + 1] === 0x01 && copy[i + 2] === 0x00) {
        copy[i + 2] = 0x02; // → 'rejection'
        break;
      }
    }
    // Either statusOk goes false, or the parse throws with code:'rejected'
    let threw = false;
    let statusOk: boolean | null = null;
    try {
      statusOk = parseTimeStampResp(copy).statusOk;
    } catch (e) {
      threw = true;
      expect(e).toMatchObject({ code: expect.stringMatching(/rejected|malformed/) });
    }
    if (!threw) expect(statusOk).toBe(false);
  });
});

describe('verifyResponseAgainstRequest (KAT)', () => {
  it.skipIf(!HAS_KAT)('returns ok:true with correct imprint+nonce', () => {
    const tsr = new Uint8Array(readFileSync(FIXTURE_TSR));
    const meta: KatMeta = JSON.parse(readFileSync(FIXTURE_META, 'utf-8'));
    const { token } = parseTimeStampResp(tsr);
    const result = verifyResponseAgainstRequest(
      token,
      hexToBytes(meta.imprintHex),
      hexToBytes(meta.nonceHex),
    );
    expect(result.ok).toBe(true);
  });

  it.skipIf(!HAS_KAT)('returns reason:imprint_mismatch when imprint flipped', () => {
    const tsr = new Uint8Array(readFileSync(FIXTURE_TSR));
    const meta: KatMeta = JSON.parse(readFileSync(FIXTURE_META, 'utf-8'));
    const { token } = parseTimeStampResp(tsr);
    const flipped = hexToBytes(meta.imprintHex);
    flipped[0] = (flipped[0] as number) ^ 0xff;
    const result = verifyResponseAgainstRequest(token, flipped, hexToBytes(meta.nonceHex));
    expect(result).toMatchObject({ ok: false, reason: 'imprint_mismatch' });
  });

  it.skipIf(!HAS_KAT)('returns reason:nonce_mismatch when nonce flipped', () => {
    const tsr = new Uint8Array(readFileSync(FIXTURE_TSR));
    const meta: KatMeta = JSON.parse(readFileSync(FIXTURE_META, 'utf-8'));
    const { token } = parseTimeStampResp(tsr);
    const flippedNonce = hexToBytes(meta.nonceHex);
    flippedNonce[0] = (flippedNonce[0] as number) ^ 0xff;
    const result = verifyResponseAgainstRequest(token, hexToBytes(meta.imprintHex), flippedNonce);
    expect(result).toMatchObject({ ok: false, reason: 'nonce_mismatch' });
  });
});
