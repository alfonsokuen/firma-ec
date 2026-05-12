import { VerificationError, ERR_PDF_PARSE, ERR_BYTERANGE_INVALID } from './errors';

export interface SignedRange {
  byteRange: [number, number, number, number];
  contents: Uint8Array;
  hasIncrementalUpdates: boolean;
  subFilter: string;
  reason?: string;
  location?: string;
  contactInfo?: string;
  /** Signing time from the /M field, if present */
  signingTimeM?: Date;
}

const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

function startsWithPdfHeader(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_HEADER.length) return false;
  for (let i = 0; i < PDF_HEADER.length; i++) if (bytes[i] !== PDF_HEADER[i]) return false;
  return true;
}

function indexOfSubarray(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function asciiSlice(bytes: Uint8Array, start: number, end: number): string {
  return new TextDecoder('latin1').decode(bytes.subarray(start, end));
}

function parseByteRange(text: string): [number, number, number, number] | null {
  // Pattern: /ByteRange [ 0 1234 5678 9012 ]   (whitespace and exact spacing varies)
  const m = text.match(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
  if (!m) return null;
  return [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10), parseInt(m[4]!, 10)];
}

/**
 * Find ALL /ByteRange occurrences in the document and return their values
 * paired with the byte offset where the `/ByteRange` token starts in `text`.
 * Used by multi-firma enumeration — each PAdES signature dict has its own
 * /ByteRange, so the number of matches equals the number of signatures.
 *
 * Sorted by `tokenAt` ascending (i.e. document order = chronological signing
 * order, since each new signature appends as an incremental update beyond
 * the prior /Contents).
 */
function findAllByteRangesWithOffsets(
  text: string,
): { value: [number, number, number, number]; tokenAt: number }[] {
  const out: { value: [number, number, number, number]; tokenAt: number }[] = [];
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({
      value: [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10), parseInt(m[4]!, 10)],
      tokenAt: m.index,
    });
  }
  return out;
}

/** Extract hex string from /Contents <DEADBEEF...>. Hex is uppercase or lowercase, may contain whitespace.
 *
 * Robustness:
 *  - Skips `/Contents N N R` (indirect object reference, common in page dicts).
 *  - Skips `/Contents <<` (start of a sub-dictionary, defensive — shouldn't happen but cheap to handle).
 *  - Iterates over every `/Contents` occurrence so we don't lock onto the first non-signature one.
 *    Real ECI/Security Data PDFs interleave page `/Contents 4 0 R` references that the previous
 *    implementation misread, producing garbage hex and an "Odd-length hex in /Contents" error.
 */
function parseContentsHex(bytes: Uint8Array, startSearchAt: number): { hex: string; openLt: number; closeGt: number } | null {
  const tag = new Uint8Array([0x2f, 0x43, 0x6f, 0x6e, 0x74, 0x65, 0x6e, 0x74, 0x73]); // /Contents
  let from = startSearchAt;
  while (from < bytes.length) {
    const at = indexOfSubarray(bytes, tag, from);
    if (at === -1) return null;
    // After /Contents the next non-whitespace token must be '<' (hex string) — anything else
    // (digit → indirect ref, '(' → literal string, '[' → array) is not a sig dict /Contents.
    let i = at + tag.length;
    while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
    if (i >= bytes.length) return null;
    if (bytes[i] !== 0x3c) {
      // Not a hex string — skip and keep searching.
      from = at + tag.length;
      continue;
    }
    // Reject '<<' (dictionary opener) defensively.
    if (i + 1 < bytes.length && bytes[i + 1] === 0x3c) {
      from = at + tag.length;
      continue;
    }
    const openLt = i;
    // Find matching '>'. Inside a hex string only hex digits and whitespace are valid;
    // a '<' would be illegal. We tolerate everything until '>' but trust the PDF spec.
    i++;
    while (i < bytes.length && bytes[i] !== 0x3e) i++; // 0x3e = '>'
    if (i === bytes.length) return null;
    const closeGt = i;
    const hex = asciiSlice(bytes, openLt + 1, closeGt).replace(/\s+/g, '');
    return { hex, openLt, closeGt };
  }
  return null;
}

function hexToBytes(hex: string): Uint8Array {
  let clean = hex.replace(/[^0-9a-f]/gi, '');
  // PDF spec §7.3.4.3: hex strings with an odd number of digits are padded with a trailing '0'.
  // Some signers (or extractors that include an extra char by mistake) produce odd hex; rather
  // than hard-failing here we apply the spec's pad-with-trailing-zero rule.
  if (clean.length % 2) clean = clean + '0';
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  // Trim trailing 0x00 padding (PAdES reserves /Contents space and pads with zeros)
  let realLen = out.length;
  while (realLen > 0 && out[realLen - 1] === 0x00) realLen--;
  return out.subarray(0, realLen);
}

function parseString(bytes: Uint8Array, key: string, startSearchAt: number): string | undefined {
  const tag = new TextEncoder().encode(`/${key}`);
  const at = indexOfSubarray(bytes, tag, startSearchAt);
  if (at === -1) return undefined;
  // Could be /Reason (xxx) — ASCII or PDFDocEncoding — or /Reason <hex>
  let i = at + tag.length;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09)) i++;
  if (bytes[i] === 0x28) { // '('
    // Read until matching ')' with nesting
    let depth = 1; i++;
    const start = i;
    while (i < bytes.length && depth > 0) {
      if (bytes[i] === 0x5c) { i += 2; continue; } // backslash escape
      if (bytes[i] === 0x28) depth++;
      else if (bytes[i] === 0x29) depth--;
      if (depth > 0) i++;
    }
    return asciiSlice(bytes, start, i);
  }
  if (bytes[i] === 0x3c) { // '<' — hex string
    i++;
    const start = i;
    while (i < bytes.length && bytes[i] !== 0x3e) i++;
    const hex = asciiSlice(bytes, start, i).replace(/\s+/g, '');
    return new TextDecoder('latin1').decode(hexToBytes(hex));
  }
  return undefined;
}

function parseDateD(bytes: Uint8Array, startSearchAt: number): Date | undefined {
  const s = parseString(bytes, 'M', startSearchAt);
  if (!s) return undefined;
  // PDF date: D:YYYYMMDDHHmmSSOHH'mm'  (e.g., D:20260508034512-05'00')
  const m = s.match(/^D?:?(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?(?:([+-Z])(\d{2})'?(\d{2})?'?)?/);
  if (!m) return undefined;
  const y   = m[1]!;
  const mo  = m[2]!;
  const d   = m[3]!;
  const h   = m[4] ?? '00';
  const mi  = m[5] ?? '00';
  const se  = m[6] ?? '00';
  const tzSign = m[7];
  const tzH = m[8] ?? '00';
  const tzM = m[9] ?? '00';
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${se}${tzSign === 'Z' || !tzSign ? 'Z' : `${tzSign}${tzH}:${tzM}`}`;
  return new Date(iso);
}

export async function findSignature(pdfBytes: Uint8Array): Promise<SignedRange | null> {
  if (!startsWithPdfHeader(pdfBytes)) {
    throw new VerificationError(ERR_PDF_PARSE, 'Not a PDF file (missing %PDF- header)');
  }

  // Find first /ByteRange — implies a signature dictionary
  const text = asciiSlice(pdfBytes, 0, pdfBytes.length);
  const byteRange = parseByteRange(text);
  if (!byteRange) return null;

  const [a, b, c, d] = byteRange;

  // Sanity-check the byte range
  if (a !== 0) {
    throw new VerificationError(ERR_BYTERANGE_INVALID, `/ByteRange first offset must be 0, got ${a}`);
  }
  if (a + b > c) {
    throw new VerificationError(ERR_BYTERANGE_INVALID, `/ByteRange overlaps: a+b (${a + b}) > c (${c})`);
  }
  if (c + d > pdfBytes.length) {
    throw new VerificationError(ERR_BYTERANGE_INVALID, `/ByteRange extends past EOF: c+d (${c + d}) > fileSize (${pdfBytes.length})`);
  }

  // Locate /Contents. Search from the /Sig dictionary area: scan from offset a to a+b for a sig dict marker.
  const contentsResult = parseContentsHex(pdfBytes, 0);
  if (!contentsResult) return null;
  const contents = hexToBytes(contentsResult.hex);

  // Verify /Contents location matches the gap in /ByteRange
  const expectedOpenLt = a + b;
  // '>' should be at c-1, so check that c equals closeGt+1 or closeGt
  if (Math.abs(contentsResult.openLt - expectedOpenLt) > 4 || Math.abs(contentsResult.closeGt - (c - 1)) > 4) {
    // Tolerance of 4 bytes for whitespace differences between PDF generators
    throw new VerificationError(
      ERR_BYTERANGE_INVALID,
      `/ByteRange does not match /Contents location: gap [${expectedOpenLt}, ${c}) vs /Contents [${contentsResult.openLt}, ${contentsResult.closeGt + 1})`,
    );
  }

  const subFilter = parseString(pdfBytes, 'SubFilter', 0) ?? 'unknown';
  const reason = parseString(pdfBytes, 'Reason', 0);
  const location = parseString(pdfBytes, 'Location', 0);
  const contactInfo = parseString(pdfBytes, 'ContactInfo', 0);
  const signingTimeM = parseDateD(pdfBytes, 0);

  const hasIncrementalUpdates = c + d < pdfBytes.length;

  return {
    byteRange,
    contents,
    hasIncrementalUpdates,
    subFilter,
    ...(reason !== undefined && { reason }),
    ...(location !== undefined && { location }),
    ...(contactInfo !== undefined && { contactInfo }),
    ...(signingTimeM !== undefined && { signingTimeM }),
  };
}
