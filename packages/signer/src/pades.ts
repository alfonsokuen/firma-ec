/**
 * PAdES-B-B PDF signing for @firma-ec/signer.
 *
 * Pipeline:
 *   1. Load PDF with pdf-lib.
 *   2. Insert /Sig dict + ByteRange placeholder via @signpdf/placeholder-pdf-lib
 *      (`pdflibAddPlaceholder`). This writes a PDF where /Contents is a hex
 *      OCTET STRING of `signatureLength` bytes (all zeros) and /ByteRange is
 *      filled with `**********`.
 *   3. Save the PDF and locate the ByteRange + /Contents window.
 *   4. Build coveredBytes = pdfBytes with /Contents zeroed (the placeholder is
 *      already zeros, so this is just `[0..a+b) ‖ [c..c+d)`).
 *   5. Hash coveredBytes with the SigAlg's hash → messageDigest.
 *   6. Build CMS SignedData (detached) over messageDigest → cmsDer.
 *   7. Hex-encode cmsDer, pad to `signatureLength * 2` chars with '0', and
 *      write into the /Contents hex window.
 *
 * Reason / Location are written to the PDF Sig dict (/Reason, /Location) via
 * `pdflibAddPlaceholder`'s named params — they are NOT added to CMS signedAttrs
 * (Decision: PAdES B-B keeps signedAttrs minimal; reason/location belong to
 *  the visible-by-Reader Sig dict — see plan F3 Task 7).
 *
 * @see docs/superpowers/specs/2026-05-09-firma-ec-F3-firma-MVP-design.md §4.3
 */

import { PDFDocument } from 'pdf-lib';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { SignerError } from './errors.js';
import { buildCmsSignedData } from './cms.js';
import { hashOf, importPrivateKey } from './webcrypto.js';
import type { ParsedPfx, SigAlg } from './types.js';

const SUBFILTER_ETSI_CADES_DETACHED = 'ETSI.CAdES.detached';
const DEFAULT_SIGNATURE_LENGTH = 16384;

export interface PadesSignOptions {
  /** Override the SigAlg suite (default: parsedPfx.sigAlg). */
  sigAlg?: SigAlg;
  /** Reason to write into the /Sig dict (PDF level, NOT CMS). */
  reason?: string;
  /** Location to write into the /Sig dict (PDF level, NOT CMS). */
  location?: string;
  /** Contact info (PDF level). */
  contactInfo?: string;
  /** Signing time (default: `new Date()`). */
  signingTime?: Date;
  /** Signature length to reserve in /Contents (bytes; default 16384). */
  signatureLength?: number;
  /** Visible-signature widget rect [x1,y1,x2,y2] (default: hidden). */
  widgetRect?: [number, number, number, number];
}

/** Extended ParsedPfx (includes PKCS#8 DER from p12.ts). */
type ParsedPfxFull = ParsedPfx & { privateKeyPkcs8Der: ArrayBuffer };

/**
 * Sign a PDF with PAdES-B-B.
 *
 * @returns The signed PDF bytes.
 */
export async function signPdfPades(
  pdfBytes: Uint8Array,
  parsedPfx: ParsedPfxFull,
  opts: PadesSignOptions = {},
): Promise<Uint8Array> {
  const sigAlg = opts.sigAlg ?? parsedPfx.sigAlg;
  const signatureLength = opts.signatureLength ?? DEFAULT_SIGNATURE_LENGTH;
  const signingTime = opts.signingTime ?? new Date();

  // 1. Load PDF + insert placeholder
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes);
  } catch (cause) {
    throw new SignerError(
      'bad_pdf',
      `pdf-lib failed to load PDF: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    );
  }

  try {
    pdflibAddPlaceholder({
      pdfDoc,
      reason: opts.reason ?? 'Firma electronica',
      contactInfo: opts.contactInfo ?? '',
      name: parsedPfx.signingCert.subjectCN,
      location: opts.location ?? '',
      signingTime,
      signatureLength,
      subFilter: SUBFILTER_ETSI_CADES_DETACHED,
      ...(opts.widgetRect ? { widgetRect: opts.widgetRect } : {}),
    });
  } catch (cause) {
    throw new SignerError(
      'cms_build_failed',
      `Placeholder insertion failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    );
  }

  // 2. Save PDF with placeholder
  let withPlaceholder: Uint8Array;
  try {
    withPlaceholder = await pdfDoc.save({ useObjectStreams: false });
  } catch (cause) {
    throw new SignerError(
      'bad_pdf',
      `pdf-lib save failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    );
  }

  // 3. Locate ByteRange + /Contents hex window
  const window = locateSignatureWindow(withPlaceholder);

  // 4. Build coveredBytes (placeholder /Contents is already zeros, so we just
  //    concatenate [0..a+b) ‖ [c..c+d) per /ByteRange).
  const [a, b, c, d] = window.byteRange;
  const covered = new Uint8Array(b + d);
  covered.set(withPlaceholder.subarray(a, a + b), 0);
  covered.set(withPlaceholder.subarray(c, c + d), b);

  // 5. Hash coveredBytes
  const hashAlg = hashOf(sigAlg);
  const messageDigest = new Uint8Array(
    await crypto.subtle.digest(
      hashAlg,
      covered.buffer.slice(covered.byteOffset, covered.byteOffset + covered.byteLength) as ArrayBuffer,
    ),
  );

  // 6. Import private key + build CMS
  const privateKey = await importPrivateKey(parsedPfx.privateKeyPkcs8Der, sigAlg);
  const cmsDer = await buildCmsSignedData({
    messageDigest,
    signerCertDer: parsedPfx.signingCert.der,
    intermediateCertDers: parsedPfx.intermediates.map((c) => c.der),
    privateKey,
    sigAlg,
    signingTime,
  });

  // 7. Hex-encode + pad + write into /Contents.
  // The placeholder reserved a hex string of `signatureLength` characters
  // (each char = one nibble — see @signpdf/placeholder-pdf-lib internals
  // where placeholder = hex of `String.fromCharCode(0).repeat(signatureLength)`,
  // i.e. `signatureLength*2` hex chars). We discover the real reserved
  // window size from the located range to be robust.
  const cmsHex = bytesToHex(cmsDer);
  const reservedHexLen = window.contentsHexEnd - window.contentsHexStart;
  if (cmsHex.length > reservedHexLen) {
    throw new SignerError(
      'signature_too_long',
      `CMS DER (${cmsDer.length} bytes, ${cmsHex.length} hex chars) exceeds reserved /Contents window (${reservedHexLen} hex chars). Increase signatureLength.`,
    );
  }
  const padded = cmsHex.padEnd(reservedHexLen, '0');

  // Write padded hex into the /Contents window
  const out = new Uint8Array(withPlaceholder);
  const enc = new TextEncoder();
  const hexBytes = enc.encode(padded);
  out.set(hexBytes, window.contentsHexStart);

  return out;
}

/** Result of locating the signature window in the placeholdered PDF. */
interface SigWindow {
  byteRange: [number, number, number, number];
  /** Offset in the PDF of the first hex digit inside `<...>` of /Contents. */
  contentsHexStart: number;
  /** Offset of the closing `>` of /Contents. */
  contentsHexEnd: number;
}

function locateSignatureWindow(pdf: Uint8Array): SigWindow {
  const text = new TextDecoder('latin1').decode(pdf);

  // /ByteRange may still hold the `**********` placeholder when @signpdf
  // hands the PDF back. We need to compute the real ByteRange ourselves
  // from the /Contents <...> hex window, then rewrite /ByteRange in place.
  // Strategy:
  //   1. Locate the /Contents hex window (always real bytes — < and >).
  //   2. Compute byteRange = [0, ltOffset+1−1, gtOffset, fileSize − gtOffset].
  //      i.e. byteRange = [0, ltOffset, gtOffset+1, fileSize-(gtOffset+1)].
  //   3. Replace the /ByteRange placeholder string with real numbers, padded
  //      with spaces so the file size doesn't change.
  const brStart = text.indexOf('/ByteRange');
  if (brStart < 0)
    throw new SignerError('cms_build_failed', '/ByteRange entry missing in placeholdered PDF');
  const brOpenBracket = text.indexOf('[', brStart);
  const brCloseBracket = text.indexOf(']', brOpenBracket);
  if (brOpenBracket < 0 || brCloseBracket < 0)
    throw new SignerError('cms_build_failed', '/ByteRange brackets missing');

  // Locate /Contents <...>
  const ctStart = text.indexOf('/Contents', brCloseBracket);
  if (ctStart < 0) throw new SignerError('cms_build_failed', '/Contents entry missing');
  let i = ctStart + '/Contents'.length;
  while (i < pdf.length && (pdf[i] === 0x20 || pdf[i] === 0x09 || pdf[i] === 0x0a || pdf[i] === 0x0d))
    i++;
  if (pdf[i] !== 0x3c)
    throw new SignerError(
      'cms_build_failed',
      `Expected '<' at /Contents start, got 0x${(pdf[i] ?? 0).toString(16)}`,
    );
  const ltOffset = i;
  let j = i + 1;
  while (j < pdf.length && pdf[j] !== 0x3e) j++;
  if (j >= pdf.length)
    throw new SignerError('cms_build_failed', '/Contents closing > not found');
  const gtOffset = j; // index of '>'

  // Compute real ByteRange:
  //   first slice: [0 .. ltOffset)         length = ltOffset
  //   second slice: [gtOffset+1 .. EOF)    length = pdf.length - (gtOffset + 1)
  const byteRange: [number, number, number, number] = [
    0,
    ltOffset,
    gtOffset + 1,
    pdf.length - (gtOffset + 1),
  ];

  // Rewrite /ByteRange in place with real numbers, preserving the original
  // bracket-to-bracket length so all offsets stay valid.
  const realStr = `[ ${byteRange[0]} ${byteRange[1]} ${byteRange[2]} ${byteRange[3]} ]`;
  const slotLen = brCloseBracket - brOpenBracket + 1;
  if (realStr.length > slotLen) {
    throw new SignerError(
      'cms_build_failed',
      `Real ByteRange string (${realStr.length}) exceeds reserved slot (${slotLen})`,
    );
  }
  const padded = realStr.padEnd(slotLen, ' ');
  const enc = new TextEncoder();
  const replacement = enc.encode(padded);
  pdf.set(replacement, brOpenBracket);

  return {
    byteRange,
    contentsHexStart: ltOffset + 1,
    contentsHexEnd: gtOffset,
  };
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}
