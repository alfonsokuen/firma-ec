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

/** Extract hex string from /Contents <DEADBEEF...>. Hex is uppercase or lowercase, may contain whitespace. */
function parseContentsHex(bytes: Uint8Array, startSearchAt: number): { hex: string; openLt: number; closeGt: number } | null {
  const tag = new Uint8Array([0x2f, 0x43, 0x6f, 0x6e, 0x74, 0x65, 0x6e, 0x74, 0x73]); // /Contents
  const at = indexOfSubarray(bytes, tag, startSearchAt);
  if (at === -1) return null;
  // Find next '<' after /Contents
  let i = at + tag.length;
  while (i < bytes.length && bytes[i] !== 0x3c) i++; // 0x3c = '<'
  if (i === bytes.length) return null;
  const openLt = i;
  // Find matching '>'
  i++;
  while (i < bytes.length && bytes[i] !== 0x3e) i++; // 0x3e = '>'
  if (i === bytes.length) return null;
  const closeGt = i;
  const hex = asciiSlice(bytes, openLt + 1, closeGt).replace(/\s+/g, '');
  return { hex, openLt, closeGt };
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  if (clean.length % 2) throw new VerificationError(ERR_PDF_PARSE, 'Odd-length hex in /Contents');
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
