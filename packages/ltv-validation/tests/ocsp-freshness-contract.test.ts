/**
 * Defect #12 — the module header of `src/ocsp/fetch.ts` promised a freshness
 * bound (`thisUpdate <= now < nextUpdate`) that the code does NOT enforce when
 * the responder omits `nextUpdate` (RFC 6960 §4.2.2.1 makes it OPTIONAL, and
 * ARCOTEL's responder does omit it for some answers). In that case the only
 * upper bound left is the LRU's 1h TTL.
 *
 * Two assertions, both about the same lie:
 *   1. BEHAVIOUR — pin what `isOcspResponseFresh` actually does with a response
 *      that has no `nextUpdate`, so the caveat can't be "fixed" by accident.
 *   2. DOCUMENTATION — the header must name the caveat. A comment that promises
 *      a security bound the code doesn't have is worse than no comment: the next
 *      reader trusts it. This is the assertion that was RED.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isOcspResponseFresh } from '../src/ocsp/fetch';
import type { OcspResult } from '../src/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const FETCH_SRC = readFileSync(resolve(HERE, '../src/ocsp/fetch.ts'), 'utf-8');
/** Only the module header (everything before the first import) makes promises. */
const FETCH_HEADER = FETCH_SRC.slice(0, FETCH_SRC.indexOf('import '));

function makeResult(over: Partial<OcspResult> = {}): OcspResult {
  return {
    ok: true,
    status: 'good',
    thisUpdate: new Date(Date.now() - 60_000),
    responseDer: new Uint8Array([0x30, 0x00]),
    url: 'http://ocsp.test.invalid/',
    ...over,
  } as OcspResult;
}

describe('isOcspResponseFresh — the nextUpdate-less case (defect #12)', () => {
  it('treats a response WITHOUT nextUpdate as fresh no matter how old it is', () => {
    const ancient = makeResult({ thisUpdate: new Date(Date.now() - 400 * 24 * 3600_000) });
    expect(ancient.nextUpdate).toBeUndefined();
    // No upper bound is applied here — the cache TTL is the only one left.
    expect(isOcspResponseFresh(ancient)).toBe(true);
  });

  it('does apply the bound when nextUpdate IS present', () => {
    const expired = makeResult({ nextUpdate: new Date(Date.now() - 1_000) });
    expect(isOcspResponseFresh(expired)).toBe(false);
  });
});

describe('the module header must document the nextUpdate-less caveat (defect #12)', () => {
  it('names `nextUpdate` being absent and the TTL that is then the only bound', () => {
    expect(FETCH_HEADER).toMatch(/nextUpdate/);
    // The header must not promise the window bound unconditionally: it has to
    // say what happens when the responder omits nextUpdate.
    expect(FETCH_HEADER.toLowerCase()).toMatch(/when .*nextupdate.* is (absent|missing|omitted)/);
    expect(FETCH_HEADER).toMatch(/TTL/);
  });
});
