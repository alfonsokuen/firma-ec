/**
 * Detect ALL existing signatures in a PDF (not just the latest).
 *
 * The verifier's `findSignature` returns the first /ByteRange it finds, which
 * is sufficient for single-sig PDFs but loses info on multi-firma sequenciales.
 * For incremental update flows we need to enumerate every Sig dict.
 *
 * Strategy (purely byte-level, no pdf-lib):
 *   1. Walk the file scanning for `/ByteRange [ a b c d ]` occurrences.
 *   2. For each, locate the matching `/Contents <hex...>` window (the closest
 *      `/Contents <` after the /ByteRange).
 *   3. Parse the embedded CMS to extract signerCN + signingTime.
 *   4. Optionally locate the Widget annotation that references the Sig dict
 *      (via /V indirect reference) to recover `pageIndex`. We do a
 *      best-effort scan: walk all `/Annots` arrays per page in order.
 *
 * The result is sorted by `byteRange[2]` (offset of the second slice) so the
 * order matches the chronological signing order — earlier signatures cover
 * fewer bytes, later signatures cover more (each appended via incremental
 * update bumps the file end past the previous /Contents window).
 *
 * @see plan F3 Task 14 (detección de firmas previas)
 */

import { fromBER } from 'asn1js';
import { Certificate, ContentInfo, SignedData } from 'pkijs';
import { SignerError } from './errors.js';

const OID_SIGNING_TIME = '1.2.840.113549.1.9.5';

interface MinimalCms {
  signerCert: Certificate;
  signingTime: Date | undefined;
}

/**
 * Minimal CMS parse: extract the signer cert + signingTime attribute.
 * Local copy to avoid cross-package rootDir violations with the verifier.
 */
async function parseCmsMinimal(contents: Uint8Array): Promise<MinimalCms> {
  const ab = contents.buffer.slice(
    contents.byteOffset,
    contents.byteOffset + contents.byteLength,
  ) as ArrayBuffer;
  const asn = fromBER(ab);
  if (asn.offset === -1) throw new Error('ASN.1 decode failed');
  const ci = new ContentInfo({ schema: asn.result });
  const sd = new SignedData({ schema: ci.content });
  const signerInfo = sd.signerInfos[0];
  if (!signerInfo) throw new Error('No signerInfo');
  const certs = (sd.certificates ?? []).filter((c): c is Certificate => c instanceof Certificate);
  // Match signerInfo.sid → signer cert. For sid=IssuerAndSerialNumber, match issuer+serial.
  // Fall back to first cert.
  let signerCert: Certificate | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sid: any = signerInfo.sid;
  if (sid?.serialNumber && sid?.issuer) {
    signerCert = certs.find(
      (c) => c.serialNumber.isEqual(sid.serialNumber) && c.issuer.isEqual(sid.issuer),
    );
  }
  if (!signerCert) signerCert = certs[0];
  if (!signerCert) throw new Error('No signer cert in CMS');

  let signingTime: Date | undefined;
  const stAttr = signerInfo.signedAttrs?.attributes.find((a) => a.type === OID_SIGNING_TIME);
  if (stAttr && stAttr.values.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v: any = stAttr.values[0];
    const d = v?.toDate?.();
    if (d instanceof Date) signingTime = d;
  }
  return { signerCert, signingTime };
}

export interface ExistingSignature {
  /** Common Name from the signer cert subject. */
  signerCN: string;
  /** Signing time from CMS signedAttrs (UTC). Undefined if absent. */
  signingTime: Date | undefined;
  /** [a, b, c, d] tuple — first slice [a..a+b), second slice [c..c+d). */
  byteRange: [number, number, number, number];
  /** 0-based page index of the Widget annotation referencing this Sig, or -1 if not located. */
  pageIndex: number;
  /** Raw CMS bytes (decoded from /Contents). */
  cmsDer: Uint8Array;
}

const TXT = (b: Uint8Array): string => new TextDecoder('latin1').decode(b);

/**
 * Find every `/ByteRange [ a b c d ]` occurrence with concrete numbers.
 * Returns offsets into `pdf` of the `[` and `]` plus the parsed quad.
 */
function findByteRanges(
  pdf: Uint8Array,
): Array<{ openBracket: number; closeBracket: number; quad: [number, number, number, number] }> {
  const text = TXT(pdf);
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  const out: Array<{
    openBracket: number;
    closeBracket: number;
    quad: [number, number, number, number];
  }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const matchStart = m.index;
    const openBracket = text.indexOf('[', matchStart);
    const closeBracket = text.indexOf(']', openBracket);
    if (openBracket < 0 || closeBracket < 0) continue;
    out.push({
      openBracket,
      closeBracket,
      quad: [
        Number.parseInt(m[1]!, 10),
        Number.parseInt(m[2]!, 10),
        Number.parseInt(m[3]!, 10),
        Number.parseInt(m[4]!, 10),
      ],
    });
  }
  return out;
}

/**
 * Extract the /Contents hex bytes directly from the /ByteRange gap.
 *
 * The quad `[a b c d]` covers everything EXCEPT the `<hex>` string of
 * /Contents — so the window lives exactly at bytes `[a+b, c)`, regardless of
 * whether /Contents appears before or after /ByteRange in the dict (iText
 * writes it after; pyHanko writes it before — the old forward-only text scan
 * broke on pyHanko-signed PDFs, v0.15.4 fix).
 */
function extractContentsFromGap(
  pdf: Uint8Array,
  quad: [number, number, number, number],
): Uint8Array | null {
  const [a, b, c] = quad;
  const start = a + b;
  if (start < 0 || c <= start || c > pdf.length) return null;
  if (pdf[start] !== 0x3c /* '<' */ || pdf[c - 1] !== 0x3e /* '>' */) return null;
  const hex = TXT(pdf.subarray(start + 1, c - 1)).replace(/\s+/g, '');
  if (hex.length === 0 || /[^0-9a-f]/i.test(hex)) return null;
  return hexToBytes(hex);
}

/**
 * Extract the /Contents hex bytes for the Sig dict whose /ByteRange ends at
 * `closeBracket`. We locate the next `/Contents <...>` after `closeBracket`,
 * then read until `>`. Legacy fallback for quads whose gap doesn't hold a
 * well-formed hex window.
 */
function extractContentsAfter(pdf: Uint8Array, closeBracket: number): Uint8Array | null {
  const text = TXT(pdf);
  const ctIdx = text.indexOf('/Contents', closeBracket);
  if (ctIdx < 0) return null;
  let i = ctIdx + '/Contents'.length;
  while (i < pdf.length) {
    const b = pdf[i]!;
    if (b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) break;
    i++;
  }
  if (pdf[i] !== 0x3c /* '<' */) return null;
  // Reject '<<'
  if (pdf[i + 1] === 0x3c) return null;
  const ltOff = i;
  let j = i + 1;
  while (j < pdf.length && pdf[j] !== 0x3e /* '>' */) j++;
  if (j >= pdf.length) return null;
  const hex = TXT(pdf.subarray(ltOff + 1, j)).replace(/\s+/g, '');
  return hexToBytes(hex);
}

function hexToBytes(hex: string): Uint8Array {
  let clean = hex.replace(/[^0-9a-f]/gi, '');
  if (clean.length % 2) clean += '0';
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = Number.parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  // Trim trailing zero padding
  let realLen = out.length;
  while (realLen > 0 && out[realLen - 1] === 0x00) realLen--;
  return out.subarray(0, realLen);
}

/** Pull CN from an X.509 subject in pkijs Certificate. */
function subjectCN(cert: Certificate): string {
  const cnAttr = cert.subject.typesAndValues.find((tv) => tv.type === '2.5.4.3');
  // pkijs typing: valueBlock.value is a string for PrintableString/UTF8String/BMPString
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  const v = (cnAttr?.value as any)?.valueBlock?.value;
  return typeof v === 'string' ? v : '';
}

/**
 * Detect every PAdES signature in `pdfBytes`. Returns an empty array if none.
 *
 * @throws SignerError('cannot_add_signature_to_corrupt_pdf') if /Contents
 *         can't be parsed for a discovered /ByteRange.
 */
export async function detectSignatures(pdfBytes: Uint8Array): Promise<ExistingSignature[]> {
  const ranges = findByteRanges(pdfBytes);
  if (ranges.length === 0) return [];

  const out: ExistingSignature[] = [];
  for (const r of ranges) {
    const cmsDer =
      extractContentsFromGap(pdfBytes, r.quad) ?? extractContentsAfter(pdfBytes, r.closeBracket);
    if (!cmsDer) {
      throw new SignerError(
        'cannot_add_signature_to_corrupt_pdf',
        `Could not locate /Contents window for /ByteRange at offset ${r.openBracket}`,
      );
    }
    let cn = '';
    let signingTime: Date | undefined;
    try {
      const cms = await parseCmsMinimal(cmsDer);
      cn = subjectCN(cms.signerCert);
      signingTime = cms.signingTime;
    } catch {
      // Best-effort: leave CN empty and signingTime undefined when CMS parse fails.
      // We still surface the entry so callers can see the slot exists.
    }
    out.push({
      signerCN: cn,
      signingTime,
      byteRange: r.quad,
      pageIndex: -1, // Best-effort; page mapping omitted in this iteration.
      cmsDer,
    });
  }
  // Stable order: ascending by start of "after-gap" slice (chronological for incremental updates).
  out.sort((x, y) => x.byteRange[2] - y.byteRange[2]);
  return out;
}
