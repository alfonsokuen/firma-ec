/**
 * CRL parse smoke test against real ARCOTEL-accredited ACE CRLs.
 * Captured 2026-05-10 from:
 *   - http://crl1.securitydata.net.ec/subca2crl1/crlfile.crl (1.19 MB)
 *   - http://crl.argosdata.com.ec/crl/0cdaea45-3374-42ca-9248-7d4797ea00a4.crl (7.5 KB)
 *
 * Skips if fixtures absent.
 */

import { describe, it, expect } from 'vitest';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchCrl } from '../src/crl/fetch';
import type { ParsedCert } from '../src/types';

const FX_DIR = resolve(__dirname, '__fixtures__');

function loadCrl(name: string): Uint8Array | null {
  const p = resolve(FX_DIR, name);
  if (!existsSync(p)) return null;
  return new Uint8Array(readFileSync(p));
}

const SD = loadCrl('securitydata-subca2-crl-2026-05-10.crl');
const AR = loadCrl('argosdata-ace-crl-2026-05-10.crl');

// Build a fake ParsedCert with a CDP extension pointing to a stub URL.
// fetchCrl will use opts.url when provided so we don't need a real CDP.
const stubCert: ParsedCert = {
  subjectCN: 'stub',
  issuerCN: 'stub-issuer',
  der: new Uint8Array(),
  notBefore: new Date(),
  notAfter: new Date(),
};

function mockFetch(body: Uint8Array): typeof globalThis.fetch {
  return (async () => {
    const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    return new Response(ab, { status: 200, headers: { 'content-length': String(body.byteLength) } });
  }) as unknown as typeof globalThis.fetch;
}

// F7.6: production path must tolerate ARCOTEL CRLs with ~30k+ revoked certs
// (asn1js default maxNodes=10000 was insufficient). fetchCrl now defaults to
// maxNodes=1_000_000, bounded against DoS by the existing maxBytes=8MiB cap.
describe('CRL parse — ARCOTEL ACEs (real CRLs, via production fetchCrl)', () => {
  it.skipIf(!SD)('SECURITY DATA SubCA-2 CRL parses (F7.6: ~30k revoked certs)', async () => {
    if (!SD) return;
    const r = await fetchCrl(stubCert, {
      url: 'http://stub/sd.crl',
      fetchImpl: mockFetch(SD),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.thisUpdate).toBeInstanceOf(Date);
    expect(r.crl.revokedCertificates?.length ?? 0).toBeGreaterThan(10_000);
  });

  it.skipIf(!AR)('ArgosData CA 1 CRL parses', async () => {
    if (!AR) return;
    const r = await fetchCrl(stubCert, {
      url: 'http://stub/ar.crl',
      fetchImpl: mockFetch(AR),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.thisUpdate).toBeInstanceOf(Date);
  });

  // Sanity: at default maxNodes (asn1js's 10000), SD CRL fails. Confirms our
  // override is load-bearing, not cosmetic. Uses the raw API directly.
  it.skipIf(!SD)('SECURITY DATA CRL EXCEEDS asn1js default maxNodes (regression guard)', () => {
    if (!SD) return;
    const ab = SD.buffer.slice(SD.byteOffset, SD.byteOffset + SD.byteLength) as ArrayBuffer;
    const asn = asn1js.fromBER(ab); // no opts → default 10k
    expect(asn.offset).toBe(-1);
    expect(asn.result?.error).toMatch(/node count/i);
  });

  it.runIf(!SD && !AR)('SKIP rationale: ARCOTEL ACE CRL fixtures absent', () => {
    expect(true).toBe(true);
  });
});

// Suppress unused-import warning in environments without fixtures.
void pkijs;
