/**
 * v0.7.29 regression — PAdES B-LTA multi-sig PDFs (CAdES signer + RFC3161
 * document timestamp wrap).
 *
 * Bugs locked here:
 *  - Bug A (P0): `verifyAllSignatures` treated the /SubFilter /ETSI.RFC3161
 *    document timestamp as a regular signer. Its TSA cert (e.g. freetsa.org
 *    ecdsa-SHA512) failed signature algorithm support → status='invalid' for
 *    "sig #2"; its cert pool also polluted `pooledIntermediates`, confusing
 *    pkijs path validation for the REAL user signature → matchedRoot became
 *    undefined and `untrusted_root` was emitted incorrectly. Real-world
 *    impact: Alfonso/ArgosData B-LTA PDFs signed by firmar.ec (with TSA wrap
 *    from freetsa.org) showed "Firma inválida" even though the user signature
 *    is cryptographically valid AND chains to ArgosData in the TSL-EC.
 *
 *  - Bug B (P0 enabler): `parseString` was scanning forward from the
 *    /ByteRange token, but /SubFilter usually precedes /ByteRange in the sig
 *    dict (alphabetical or producer-specific ordering). The forward scan
 *    bled into the NEXT sig dict, returning the wrong subFilter or 'unknown'.
 *    v0.7.29 anchors the scan at the enclosing `<<` dict opener.
 *
 *  - Bug C (B-LTA correctness): a document timestamp legitimately appends
 *    bytes after the user sig. Flagging `incremental_updates` on a user sig
 *    just because a DTS follows it is wrong — the DTS is the whole point of
 *    B-LTA. v0.7.29 suppresses the warning when the appended bytes are a
 *    DTS wrap that reaches EOF.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { verifyAllSignatures } from '../src/index';
import { findAllSignatures } from '../src/pdf';

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const PDF = 'carta-arrendamiento-firmado.pdf';

describe('v0.7.29 — B-LTA multi-sig: user sig + RFC3161 DocTimeStamp wrap', () => {
  test('Bug B: parseString anchors at enclosing dict, finds correct /SubFilter per sig', async () => {
    const bytes = new Uint8Array(await readFile(resolve(FIX, PDF)));
    const sigs = await findAllSignatures(bytes);
    expect(sigs).toHaveLength(2);
    expect(sigs[0]!.subFilter).toBe('ETSI.CAdES.detached');
    expect(sigs[1]!.subFilter).toBe('ETSI.RFC3161');
  });

  test('Bug A: DTS is filtered out of user-signature list; user sig matches ArgosData root', async () => {
    const bytes = new Uint8Array(await readFile(resolve(FIX, PDF)));
    const r = await verifyAllSignatures(bytes, { fetchOcsp: false });
    expect(r.signatureCount).toBe(1);
    expect(r.signatures).toHaveLength(1);
    const s = r.signatures[0]!;
    expect(s.signer?.cert.subject.cn).toBe('Alfonso Kuen Arroyo');
    expect(s.signer?.matchedRootSlug).toBe('argosdata');
    expect(s.integrity?.digestMatches).toBe(true);
    expect(s.signature?.profile).toBe('B-LTA');
  });

  test('Bug C: DTS-wrapped user sig does NOT raise incremental_updates and remains valid', async () => {
    const bytes = new Uint8Array(await readFile(resolve(FIX, PDF)));
    const r = await verifyAllSignatures(bytes, { fetchOcsp: false });
    const s = r.signatures[0]!;
    const codes = s.warnings.map((w) => w.code);
    expect(codes).not.toContain('incremental_updates');
    expect(codes).not.toContain('untrusted_root');
    expect(s.status).toBe('valid');
    expect(r.overallStatus).toBe('valid');
  });
});
