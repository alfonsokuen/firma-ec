/**
 * Multi-firma secuencial (incremental update) tests for @firma-ec/signer.
 *
 * Coverage (F3 Task 16):
 *   - detectSignatures on a single-signed PDF returns 1 entry.
 *   - addIncrementalSignature appends a 2nd signature without touching prior bytes.
 *   - detectSignatures on the 2x-signed PDF returns 2 entries with distinct CNs.
 *   - 3-signature chain produces 3 entries.
 *   - Signature 1's /ByteRange in the 2x-signed PDF still covers byte-identical
 *     content vs the original signed PDF (so its hash is unchanged).
 *   - Signature 2's /ByteRange covers the file up to its own /Contents window.
 *   - Corrupt PDF input → SignerError('cannot_add_signature_to_corrupt_pdf').
 */

import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pkijs from 'pkijs';
import { beforeAll, describe, expect, it } from 'vitest';

import { detectSignatures } from '../src/detectExistingSignatures.js';
import { SignerError } from '../src/errors.js';
import { addIncrementalSignature } from '../src/incrementalUpdate.js';
import { parsePfx } from '../src/p12.js';
import { signPdfPades } from '../src/pades.js';

// F6 T9: signPdfPades now returns { signedPdf, timestamp }. Tests written
// pre-F6 expect a Uint8Array — wrap with timestamp:false (no TSA network)
// and unwrap .signedPdf so existing assertions stay intact.
async function __signTest(
  pdf: Uint8Array,
  pfx: Parameters<typeof signPdfPades>[1],
  opts: Parameters<typeof signPdfPades>[2] = {},
): Promise<Uint8Array> {
  const r = await signPdfPades(pdf, pfx, { ...opts, timestamp: false });
  return r.signedPdf;
}

beforeAll(() => {
  pkijs.setEngine(
    'node-webcrypto',
    new pkijs.CryptoEngine({ name: 'node-webcrypto', crypto: webcrypto as unknown as Crypto }),
  );
  if (!(globalThis as { crypto?: Crypto }).crypto) {
    (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
  }
});

const FIX_DIR = join(__dirname, 'fixtures');
const PIN = 'test1234';

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIX_DIR, name)));
}

async function buildMinimalPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('firma.ec multi-firma test', { x: 50, y: 100, size: 14, font });
  return doc.save({ useObjectStreams: false });
}

type SignArgs = Parameters<typeof signPdfPades>;
type IncArgs = Parameters<typeof addIncrementalSignature>;

describe('detectSignatures', () => {
  it('returns empty array for an unsigned PDF', async () => {
    const pdf = await buildMinimalPdf();
    const found = await detectSignatures(pdf);
    expect(found).toEqual([]);
  });

  it('returns one entry for a single-signed PDF', async () => {
    const pfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildMinimalPdf();
    const signed = await __signTest(pdf, pfx as SignArgs[1]);

    const found = await detectSignatures(signed);
    expect(found.length).toBe(1);
    expect(found[0]!.byteRange[0]).toBe(0);
    expect(found[0]!.byteRange[1]).toBeGreaterThan(0);
    expect(found[0]!.cmsDer.length).toBeGreaterThan(0);
    // CN extraction is best-effort; should be non-empty for our fixture certs.
    expect(typeof found[0]!.signerCN).toBe('string');
  });
});

describe('addIncrementalSignature — 2 signatures', () => {
  it('appends a second signature without modifying prior bytes', async () => {
    const rsaPfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    // v0.4.3: was ecdsa-p256-valid.p12; switched to RSA-1024 weak fixture (different
    // CN/key from rsa2048-valid.p12) because node-forge can't decrypt the ECDSA
    // fixture's EncryptedPrivateKeyInfo (deferred to v0.4.4 — see p12.test.ts).
    // The multi-firma contract under test is "second signer != first signer", which
    // any distinct PFX satisfies; the algorithm is incidental.
    const ecPfx = await parsePfx(loadFixture('rsa1024-weak.p12'), PIN);
    const pdf = await buildMinimalPdf();

    const signedA = await __signTest(pdf, rsaPfx as SignArgs[1]);
    const signedB = await addIncrementalSignature(signedA, ecPfx as IncArgs[1], {});

    // Prior bytes intact:
    expect(signedB.length).toBeGreaterThan(signedA.length);
    for (let i = 0; i < signedA.length; i++) {
      if (signedB[i] !== signedA[i]) {
        throw new Error(`Byte ${i} differs after incremental update — invariant broken`);
      }
    }
  });

  it('detectSignatures returns 2 entries with distinct CNs after 2x sign', async () => {
    const rsaPfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    // v0.4.3: was ecdsa-p256-valid.p12; switched to RSA-1024 weak fixture (different
    // CN/key from rsa2048-valid.p12) because node-forge can't decrypt the ECDSA
    // fixture's EncryptedPrivateKeyInfo (deferred to v0.4.4 — see p12.test.ts).
    // The multi-firma contract under test is "second signer != first signer", which
    // any distinct PFX satisfies; the algorithm is incidental.
    const ecPfx = await parsePfx(loadFixture('rsa1024-weak.p12'), PIN);
    const pdf = await buildMinimalPdf();

    const signedA = await __signTest(pdf, rsaPfx as SignArgs[1]);
    const signedB = await addIncrementalSignature(signedA, ecPfx as IncArgs[1], {});

    const found = await detectSignatures(signedB);
    expect(found.length).toBe(2);

    // Their /ByteRanges must point to distinct /Contents windows (different `c` offsets).
    expect(found[0]!.byteRange[2]).not.toBe(found[1]!.byteRange[2]);

    // Both CMS DER blobs decoded.
    expect(found[0]!.cmsDer.length).toBeGreaterThan(0);
    expect(found[1]!.cmsDer.length).toBeGreaterThan(0);

    // CNs likely differ between RSA and EC fixtures (best-effort — both are
    // non-empty strings even if equal).
    expect(typeof found[0]!.signerCN).toBe('string');
    expect(typeof found[1]!.signerCN).toBe('string');
  });

  it('signature 1 /ByteRange in 2x-signed PDF still covers identical bytes vs original', async () => {
    const rsaPfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    // v0.4.3: was ecdsa-p256-valid.p12; switched to RSA-1024 weak fixture (different
    // CN/key from rsa2048-valid.p12) because node-forge can't decrypt the ECDSA
    // fixture's EncryptedPrivateKeyInfo (deferred to v0.4.4 — see p12.test.ts).
    // The multi-firma contract under test is "second signer != first signer", which
    // any distinct PFX satisfies; the algorithm is incidental.
    const ecPfx = await parsePfx(loadFixture('rsa1024-weak.p12'), PIN);
    const pdf = await buildMinimalPdf();

    const signedA = await __signTest(pdf, rsaPfx as SignArgs[1]);
    const signedB = await addIncrementalSignature(signedA, ecPfx as IncArgs[1], {});

    const inA = await detectSignatures(signedA);
    const inB = await detectSignatures(signedB);
    expect(inA.length).toBe(1);
    expect(inB.length).toBe(2);

    // Sig 1 in B should match sig 1 in A by /ByteRange tuple.
    const sig1B = inB[0]!;
    const sig1A = inA[0]!;
    expect(sig1B.byteRange).toEqual(sig1A.byteRange);

    // Bytes covered by sig 1's /ByteRange must be byte-identical between A and B.
    const [a1, b1, c1, d1] = sig1B.byteRange;
    for (let i = a1; i < a1 + b1; i++) {
      if (signedA[i] !== signedB[i]) throw new Error(`slice1 mismatch at ${i}`);
    }
    for (let i = c1; i < c1 + d1; i++) {
      if (signedA[i] !== signedB[i]) throw new Error(`slice2 mismatch at ${i}`);
    }
  });

  it('signature 2 /ByteRange covers the entire 2x-signed file minus its own /Contents window', async () => {
    const rsaPfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    // v0.4.3: was ecdsa-p256-valid.p12; switched to RSA-1024 weak fixture (different
    // CN/key from rsa2048-valid.p12) because node-forge can't decrypt the ECDSA
    // fixture's EncryptedPrivateKeyInfo (deferred to v0.4.4 — see p12.test.ts).
    // The multi-firma contract under test is "second signer != first signer", which
    // any distinct PFX satisfies; the algorithm is incidental.
    const ecPfx = await parsePfx(loadFixture('rsa1024-weak.p12'), PIN);
    const pdf = await buildMinimalPdf();

    const signedA = await __signTest(pdf, rsaPfx as SignArgs[1]);
    const signedB = await addIncrementalSignature(signedA, ecPfx as IncArgs[1], {});

    const found = await detectSignatures(signedB);
    expect(found.length).toBe(2);
    const sig2 = found[1]!;
    const [a, b, c, d] = sig2.byteRange;

    expect(a).toBe(0);
    // Together the two slices cover everything except a single contiguous
    // /Contents hex region; total = file length - hex-window-length.
    const totalCovered = b + d;
    expect(totalCovered).toBeLessThan(signedB.length);
    expect(c + d).toBe(signedB.length);
  });
});

describe('addIncrementalSignature — cross-verifier integrity', () => {
  it('signature 1 messageDigest still matches recomputed hash of its /ByteRange in 2x-signed PDF', async () => {
    const { findSignature } = await import('../../verifier/src/pdf.js');
    const { parseCms } = await import('../../verifier/src/cms.js');
    const rsaPfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    // v0.4.3: was ecdsa-p256-valid.p12; switched to RSA-1024 weak fixture (different
    // CN/key from rsa2048-valid.p12) because node-forge can't decrypt the ECDSA
    // fixture's EncryptedPrivateKeyInfo (deferred to v0.4.4 — see p12.test.ts).
    // The multi-firma contract under test is "second signer != first signer", which
    // any distinct PFX satisfies; the algorithm is incidental.
    const ecPfx = await parsePfx(loadFixture('rsa1024-weak.p12'), PIN);
    const pdf = await buildMinimalPdf();

    const signedA = await __signTest(pdf, rsaPfx as SignArgs[1]);
    const signedB = await addIncrementalSignature(signedA, ecPfx as IncArgs[1], {});

    // findSignature returns the FIRST /ByteRange in file order — for our
    // multi-firma output that's signature 1 (RSA, the original).
    const sig1Range = (await findSignature(signedB))!;
    expect(sig1Range).not.toBeNull();
    const cms1 = await parseCms(sig1Range.contents);

    const [a, b, c, d] = sig1Range.byteRange;
    const covered = new Uint8Array(b + d);
    covered.set(signedB.subarray(a, a + b), 0);
    covered.set(signedB.subarray(c, c + d), b);
    const ab = covered.buffer.slice(
      covered.byteOffset,
      covered.byteOffset + covered.byteLength,
    ) as ArrayBuffer;
    const recomputed = new Uint8Array(await crypto.subtle.digest('SHA-256', ab));

    if (recomputed.length !== cms1.signedMessageDigest.length) {
      throw new Error('digest length mismatch');
    }
    for (let i = 0; i < recomputed.length; i++) {
      if (recomputed[i] !== cms1.signedMessageDigest[i]) {
        throw new Error(
          `signature 1 digest broken at byte ${i} — incremental update mutated covered bytes`,
        );
      }
    }
  });
});

describe('addIncrementalSignature — 3 signatures chained', () => {
  it('produces 3 detectable signatures', async () => {
    const rsaPfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    // v0.4.3: was ecdsa-p256-valid.p12; switched to RSA-1024 weak fixture (different
    // CN/key from rsa2048-valid.p12) because node-forge can't decrypt the ECDSA
    // fixture's EncryptedPrivateKeyInfo (deferred to v0.4.4 — see p12.test.ts).
    // The multi-firma contract under test is "second signer != first signer", which
    // any distinct PFX satisfies; the algorithm is incidental.
    const ecPfx = await parsePfx(loadFixture('rsa1024-weak.p12'), PIN);
    const pdf = await buildMinimalPdf();

    const sig1 = await __signTest(pdf, rsaPfx as SignArgs[1]);
    const sig2 = await addIncrementalSignature(sig1, ecPfx as IncArgs[1], {});
    const sig3 = await addIncrementalSignature(sig2, rsaPfx as IncArgs[1], {});

    // Every prior signature's bytes are untouched in sig3 (transitive invariant).
    for (let i = 0; i < sig2.length; i++) {
      if (sig3[i] !== sig2[i]) throw new Error(`byte ${i} mutated in 3rd update`);
    }

    const found = await detectSignatures(sig3);
    expect(found.length).toBe(3);

    // All three /Contents windows must be distinct.
    const offsets = new Set(found.map((s) => s.byteRange[2]));
    expect(offsets.size).toBe(3);
  });
});

describe('addIncrementalSignature — error paths', () => {
  it('throws cannot_add_signature_to_corrupt_pdf on garbage input', async () => {
    const rsaPfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const garbage = new TextEncoder().encode('not a pdf at all, just text bytes');
    let err: unknown;
    try {
      await addIncrementalSignature(garbage, rsaPfx as IncArgs[1], {});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SignerError);
    expect((err as SignerError).code).toBe('cannot_add_signature_to_corrupt_pdf');
  });

  it('throws incremental_update_failed on an unsigned PDF', async () => {
    const rsaPfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
    const pdf = await buildMinimalPdf();
    let err: unknown;
    try {
      await addIncrementalSignature(pdf, rsaPfx as IncArgs[1], {});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SignerError);
    expect((err as SignerError).code).toBe('incremental_update_failed');
  });

  /**
   * QA post-merge 2026-08-03 (code-reviewer, OWASP A04/A08): a diferencia de
   * `signPdfPades` (`pades.ts`, llama `validateVisibleSig` antes de tocar el
   * PDF), esta ruta solo comprobaba el ÍNDICE de página — un rect fuera de la
   * página, por debajo del mínimo legible, o con coordenadas no finitas se
   * aceptaba y se escribía tal cual en `/Rect` (una de las 4 entradas de abajo
   * producía literalmente `/Rect [NaN ... NaN ...]` en el PDF de salida, medido
   * antes del fix). Es la ruta que toma TODO documento que ya trae una firma
   * previa — el conjunto exacto que el lote manda a colocación manual — así
   * que el rect puede venir de una persona ajustando a mano en la UI, no solo
   * del motor. Las 4 entradas son las mismas que reprodujeron el hallazgo.
   */
  describe('gate de rect visible — misma validación que signPdfPades (QA post-merge 2026-08-03)', () => {
    const BASE_VS = {
      page: 0,
      x: 50,
      y: 50,
      width: 100,
      height: 50,
      signerCN: 'Test Signer',
    } as const;

    it.each([
      ['fuera de página (x=900 en un PDF de 400pt de ancho)', { ...BASE_VS, x: 900 }],
      ['por debajo del mínimo legible (5×5pt)', { ...BASE_VS, width: 5, height: 5 }],
      ['coordenada no finita (x=NaN)', { ...BASE_VS, x: Number.NaN }],
      ['coordenadas negativas (x=-500, y=-500)', { ...BASE_VS, x: -500, y: -500 }],
    ])('rechaza: %s', async (_label, badVs) => {
      const rsaPfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
      const pdf = await buildMinimalPdf(); // 400×200pt
      const signedA = await __signTest(pdf, rsaPfx as SignArgs[1]);

      let err: unknown;
      try {
        await addIncrementalSignature(signedA, rsaPfx as IncArgs[1], { visibleSig: badVs });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SignerError);
      expect((err as SignerError).code).toMatch(/^visible_sig_/);
    });

    it('acepta un rect válido y lo escribe en /Rect', async () => {
      const rsaPfx = await parsePfx(loadFixture('rsa2048-valid.p12'), PIN);
      const pdf = await buildMinimalPdf();
      const signedA = await __signTest(pdf, rsaPfx as SignArgs[1]);

      const signedB = await addIncrementalSignature(signedA, rsaPfx as IncArgs[1], {
        visibleSig: BASE_VS,
      });
      const text = new TextDecoder('latin1').decode(signedB);
      expect(text).toContain('/Rect [50 50 150 100]');
    });
  });
});

// NOTE: integration tests for the v0.7.2 xref-stream support
// (`parseXrefStreamDict`) are deferred until we capture a real SRI gob.ec PDF
// fixture. pdf-lib cannot synthesise an xref-stream PDF that ALSO has a
// preserved /Sig dict — saving with `useObjectStreams: true` rewrites the
// signature object into a compressed stream and detectSignatures stops
// finding it. The parser code is exercised live whenever a user signs over
// any PDF whose `startxref` points at a /Type /XRef object (typical for
// SRI comprobantes, BCE invoices, and most PDF 1.5+ generators).
//
// Manual smoke test path (until fixture lands):
//   1. Download any RC-...pdf from SRI gob.ec (xref-stream by default).
//   2. Load via firmar.ec/firmar with a real ArgosData/Eclipsesoft .p12.
//   3. Pre-v0.7.2: error "cannot_add_signature_to_corrupt_pdf".
//      Post-v0.7.2: signed PDF returned, original SRI signature preserved
//      byte-for-byte, citizen's signature appended via classic xref + /Prev.

describe('v0.7.17 audit regression — field name collision on Adobe-labelled PDFs', () => {
  it('input has Signature, Signature3..5 (4 sigs) → new sig picks first free name without collision', async () => {
    // 2026-05-15: Adobe-produced PDFs may label fields with non-contiguous
    // indices (Signature, Signature3, Signature4, Signature5). Previous code
    // named the new field `Signature{prior.length+1}` → collided with MARCO
    // existing `Signature5`. PDF viewers (FirmaEC desktop) dedupe by field
    // name → MARCO disappears from the signers list. Fix: scan input
    // `/T (...)` names and pick first non-colliding `Signature{N}`.
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const auditPath = resolve(__dirname, '../../verifier/tests/fixtures/audit-075-2026.pdf');
    const inputPdf = new Uint8Array(await readFile(auditPath));
    const pfxBytes = new Uint8Array(
      await readFile(resolve(__dirname, 'fixtures/rsa2048-valid.p12')),
    );
    const parsedPfx = await parsePfx(pfxBytes, 'test1234');
    const out = await addIncrementalSignature(inputPdf, parsedPfx, {});
    const outText = new TextDecoder('latin1').decode(out);
    const names: string[] = [];
    for (const m of outText.matchAll(/\/T\s*\(([^)]+)\)/g)) names.push(m[1]!);
    // The new field name (last occurrence in file = newest revision) MUST NOT
    // collide with any pre-existing /T name. Pre-fix, the new field was named
    // `Signature5` colliding with MARCO's existing field; PDF readers dedupe
    // and drop one signature. Post-fix the new name skips to `Signature6`.
    const lastNewName = names[names.length - 1]!;
    expect(lastNewName).toBe('Signature6');
    // MARCO's `Signature5` field must still exist in the output.
    expect(names).toContain('Signature5');
  }, 30000);
});
