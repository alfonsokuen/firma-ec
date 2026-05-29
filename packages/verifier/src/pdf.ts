import { ERR_BYTERANGE_INVALID, ERR_PDF_PARSE, VerificationError } from './errors';

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
  return [
    Number.parseInt(m[1]!, 10),
    Number.parseInt(m[2]!, 10),
    Number.parseInt(m[3]!, 10),
    Number.parseInt(m[4]!, 10),
  ];
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
      value: [
        Number.parseInt(m[1]!, 10),
        Number.parseInt(m[2]!, 10),
        Number.parseInt(m[3]!, 10),
        Number.parseInt(m[4]!, 10),
      ],
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
function parseContentsHex(
  bytes: Uint8Array,
  startSearchAt: number,
): { hex: string; openLt: number; closeGt: number } | null {
  const tag = new Uint8Array([0x2f, 0x43, 0x6f, 0x6e, 0x74, 0x65, 0x6e, 0x74, 0x73]); // /Contents
  let from = startSearchAt;
  while (from < bytes.length) {
    const at = indexOfSubarray(bytes, tag, from);
    if (at === -1) return null;
    // After /Contents the next non-whitespace token must be '<' (hex string) — anything else
    // (digit → indirect ref, '(' → literal string, '[' → array) is not a sig dict /Contents.
    let i = at + tag.length;
    while (
      i < bytes.length &&
      (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)
    )
      i++;
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
  for (let i = 0; i < out.length; i++)
    out[i] = Number.parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  // Trim trailing 0x00 padding (PAdES reserves /Contents space and pads with zeros)
  let realLen = out.length;
  while (realLen > 0 && out[realLen - 1] === 0x00) realLen--;
  return out.subarray(0, realLen);
}

/**
 * Walk backward from `pos` to find the matching `<<` that opens the PDF
 * dictionary containing `pos`. Handles nested dicts via depth counting.
 * Returns offset of the `<<` token (start of dict) or 0 if not found within
 * a sane window.
 */
function findDictStart(bytes: Uint8Array, pos: number, maxLookback = 4096): number {
  let depth = 0;
  const limit = Math.max(0, pos - maxLookback);
  for (let i = pos - 1; i >= limit; i--) {
    // Look for `>>` (close) and `<<` (open). Each is two bytes.
    if (i + 1 < bytes.length && bytes[i] === 0x3e && bytes[i + 1] === 0x3e) {
      depth++;
      i--; // skip the second '>'
      continue;
    }
    if (i + 1 < bytes.length && bytes[i] === 0x3c && bytes[i + 1] === 0x3c) {
      if (depth === 0) return i;
      depth--;
      i--; // skip the second '<'
      continue;
    }
  }
  return Math.max(0, pos - maxLookback);
}

function parseString(bytes: Uint8Array, key: string, startSearchAt: number): string | undefined {
  const tag = new TextEncoder().encode(`/${key}`);
  // v0.7.29 — Scope the search to the enclosing sig dict by anchoring at its
  // `<<` opener (PDF dicts: /Type /SubFilter /ByteRange /Contents are usually
  // listed in alphabetical or producer-specific order, so /SubFilter can come
  // BEFORE /ByteRange). Searching forward from /ByteRange.tokenAt was finding
  // the NEXT sig's /SubFilter — confusing DocTimeStamp detection in B-LTA PDFs.
  const dictStart = findDictStart(bytes, startSearchAt);
  const at = indexOfSubarray(bytes, tag, dictStart);
  if (at === -1) return undefined;
  // Could be /Reason (xxx) — ASCII or PDFDocEncoding — or /Reason <hex>
  let i = at + tag.length;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09)) i++;
  if (bytes[i] === 0x28) {
    // '('
    // Read until matching ')' with nesting
    let depth = 1;
    i++;
    const start = i;
    while (i < bytes.length && depth > 0) {
      if (bytes[i] === 0x5c) {
        i += 2;
        continue;
      } // backslash escape
      if (bytes[i] === 0x28) depth++;
      else if (bytes[i] === 0x29) depth--;
      if (depth > 0) i++;
    }
    return asciiSlice(bytes, start, i);
  }
  if (bytes[i] === 0x3c) {
    // '<' — hex string
    i++;
    const start = i;
    while (i < bytes.length && bytes[i] !== 0x3e) i++;
    const hex = asciiSlice(bytes, start, i).replace(/\s+/g, '');
    return new TextDecoder('latin1').decode(hexToBytes(hex));
  }
  if (bytes[i] === 0x2f) {
    // '/' — PDF Name object (used by /SubFilter, /Type, /Filter). Names are
    // delimited by whitespace or any PDF delimiter character. v0.7.29: prior
    // versions returned undefined for Names, leaving /SubFilter as 'unknown'
    // which broke DocTimeStamp (/ETSI.RFC3161) classification.
    i++;
    const start = i;
    while (i < bytes.length) {
      const b = bytes[i];
      // Whitespace: NUL, TAB, LF, FF, CR, SP.
      if (b === 0x00 || b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20) break;
      // Delimiters: ( ) < > [ ] { } / %.
      if (
        b === 0x28 ||
        b === 0x29 ||
        b === 0x3c ||
        b === 0x3e ||
        b === 0x5b ||
        b === 0x5d ||
        b === 0x7b ||
        b === 0x7d ||
        b === 0x2f ||
        b === 0x25
      )
        break;
      i++;
    }
    return asciiSlice(bytes, start, i);
  }
  return undefined;
}

/**
 * Extract the /Contents hex directly from the unsigned ByteRange gap.
 *
 * PAdES requires the signature octet string `<…>` to occupy exactly the bytes
 * NOT covered by the signature, i.e. the hole `[gapStart=a+b, gapEnd=c)`. This
 * is producer-order-independent, so it works even when the sig dict lists
 * `/Contents` BEFORE `/ByteRange` (observed with Security Data / BCE Ecuadorian
 * ECIs), a layout that defeats the forward-only token search in
 * {@link parseContentsHex}. The `<` opener sits at/just after `gapStart` and the
 * `>` closer at `gapEnd - 1`; we tolerate a little leading whitespace.
 */
function parseContentsFromGap(
  bytes: Uint8Array,
  gapStart: number,
  gapEnd: number,
): { hex: string; openLt: number; closeGt: number } | null {
  if (gapStart < 0 || gapEnd > bytes.length || gapStart >= gapEnd) return null;
  let i = gapStart;
  // Skip leading whitespace, then require '<' (the hex-string opener).
  while (i < gapEnd && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d))
    i++;
  if (i >= gapEnd || bytes[i] !== 0x3c) return null;
  // Reject '<<' (dictionary opener) defensively.
  if (i + 1 < gapEnd && bytes[i + 1] === 0x3c) return null;
  const openLt = i;
  i++;
  const start = i;
  while (i < gapEnd && bytes[i] !== 0x3e) i++; // 0x3e = '>'
  if (i >= gapEnd) return null;
  const closeGt = i;
  const hex = asciiSlice(bytes, start, closeGt).replace(/\s+/g, '');
  return { hex, openLt, closeGt };
}

function parseDateD(bytes: Uint8Array, startSearchAt: number): Date | undefined {
  const s = parseString(bytes, 'M', startSearchAt);
  if (!s) return undefined;
  // PDF date: D:YYYYMMDDHHmmSSOHH'mm'  (e.g., D:20260508034512-05'00')
  const m = s.match(
    /^D?:?(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?(?:([+-Z])(\d{2})'?(\d{2})?'?)?/,
  );
  if (!m) return undefined;
  const y = m[1]!;
  const mo = m[2]!;
  const d = m[3]!;
  const h = m[4] ?? '00';
  const mi = m[5] ?? '00';
  const se = m[6] ?? '00';
  const tzSign = m[7];
  const tzH = m[8] ?? '00';
  const tzM = m[9] ?? '00';
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${se}${tzSign === 'Z' || !tzSign ? 'Z' : `${tzSign}${tzH}:${tzM}`}`;
  return new Date(iso);
}

/**
 * Find every PAdES signature in the PDF and return them in document order
 * (chronological signing order, since each new signature appends as an
 * incremental update beyond the prior /Contents window).
 *
 * Multi-firma support (v0.7.1+): the array contains one entry per /ByteRange
 * found, each paired with its own /Contents hex string and dictionary metadata
 * (SubFilter, Reason, Location, ContactInfo, /M signing time).
 *
 * Pairing logic: for ByteRange [a,b,c,d], the /Contents hex MUST start at
 * offset `a+b` (PAdES requires the signature gap to coincide with /Contents).
 * We seek /Contents starting from the /ByteRange token position to grab the
 * one inside the same sig dict; we then validate that the found openLt is
 * within 4 bytes of `a+b` and closeGt is within 4 bytes of `c-1`.
 *
 * Returns an empty array if the PDF has no signatures (vs throwing).
 * Throws `ERR_BYTERANGE_INVALID` only when a found /ByteRange fails sanity
 * checks (negative offsets, overlap, past-EOF) — these indicate a malformed
 * sig dict, not "no signature".
 */
export async function findAllSignatures(pdfBytes: Uint8Array): Promise<SignedRange[]> {
  if (!startsWithPdfHeader(pdfBytes)) {
    throw new VerificationError(ERR_PDF_PARSE, 'Not a PDF file (missing %PDF- header)');
  }

  const text = asciiSlice(pdfBytes, 0, pdfBytes.length);
  const byteRanges = findAllByteRangesWithOffsets(text);
  if (byteRanges.length === 0) return [];

  const out: SignedRange[] = [];

  for (const br of byteRanges) {
    const [a, b, c, d] = br.value;

    // Sanity per signature
    if (a !== 0) {
      throw new VerificationError(
        ERR_BYTERANGE_INVALID,
        `/ByteRange first offset must be 0, got ${a}`,
      );
    }
    if (a + b > c) {
      throw new VerificationError(
        ERR_BYTERANGE_INVALID,
        `/ByteRange overlaps: a+b (${a + b}) > c (${c})`,
      );
    }
    if (c + d > pdfBytes.length) {
      throw new VerificationError(
        ERR_BYTERANGE_INVALID,
        `/ByteRange extends past EOF: c+d (${c + d}) > fileSize (${pdfBytes.length})`,
      );
    }

    // Scope all per-sig lookups to forward search from the /ByteRange token.
    // PDF sig dicts are contiguous: /ByteRange, /Contents, /SubFilter, /Reason
    // etc. all live in the same `<< … >>` block, so starting from the
    // /ByteRange token reliably lands on the right /Contents window without
    // bleeding into a later signature's metadata.
    const expectedOpenLt = a + b;
    const windowOk = (r: { openLt: number; closeGt: number }): boolean =>
      Math.abs(r.openLt - expectedOpenLt) <= 4 && Math.abs(r.closeGt - (c - 1)) <= 4;

    // Primary: forward token search from the /ByteRange token (handles the
    // common dict order /ByteRange … /Contents). Fallback: extract the hex
    // straight from the unsigned gap [a+b, c) — producer-order-independent, so
    // it recovers signatures whose dict lists /Contents BEFORE /ByteRange
    // (Security Data / BCE Ecuadorian ECIs), which the forward search misses.
    let contentsResult = parseContentsHex(pdfBytes, br.tokenAt);
    if (!contentsResult || !windowOk(contentsResult)) {
      const fromGap = parseContentsFromGap(pdfBytes, a + b, c);
      if (fromGap) contentsResult = fromGap;
    }
    if (!contentsResult) {
      throw new VerificationError(
        ERR_BYTERANGE_INVALID,
        `/Contents not found for /ByteRange at offset ${br.tokenAt}`,
      );
    }
    const contents = hexToBytes(contentsResult.hex);

    // Validate /Contents window matches /ByteRange gap [a+b, c).
    if (!windowOk(contentsResult)) {
      throw new VerificationError(
        ERR_BYTERANGE_INVALID,
        `/ByteRange does not match /Contents location for sig at offset ${br.tokenAt}: gap [${expectedOpenLt}, ${c}) vs /Contents [${contentsResult.openLt}, ${contentsResult.closeGt + 1})`,
      );
    }

    const subFilter = parseString(pdfBytes, 'SubFilter', br.tokenAt) ?? 'unknown';
    const reason = parseString(pdfBytes, 'Reason', br.tokenAt);
    const location = parseString(pdfBytes, 'Location', br.tokenAt);
    const contactInfo = parseString(pdfBytes, 'ContactInfo', br.tokenAt);
    const signingTimeM = parseDateD(pdfBytes, br.tokenAt);

    // hasIncrementalUpdates: bytes appended past this signature's /ByteRange
    // end. For non-last signatures this is always true (the next signature is
    // appended); for the last signature it indicates appended bytes the last
    // signature does not cover.
    const hasIncrementalUpdates = c + d < pdfBytes.length;

    out.push({
      byteRange: br.value,
      contents,
      hasIncrementalUpdates,
      subFilter,
      ...(reason !== undefined && { reason }),
      ...(location !== undefined && { location }),
      ...(contactInfo !== undefined && { contactInfo }),
      ...(signingTimeM !== undefined && { signingTimeM }),
    });
  }

  return out;
}

/**
 * Back-compat shim: returns the FIRST signature found, or null if none.
 * Equivalent to `(await findAllSignatures(pdf))[0] ?? null`.
 * New code should call `findAllSignatures` directly to enumerate every
 * signature in a multi-firma PDF.
 */
export async function findSignature(pdfBytes: Uint8Array): Promise<SignedRange | null> {
  const all = await findAllSignatures(pdfBytes);
  return all[0] ?? null;
}
