/**
 * DSS extractor (verifier helper).
 *
 * Walks the PDF byte stream looking for the Catalog /DSS reference, follows it
 * to the DSS dict, dereferences each stream in /Certs, /OCSPs, /CRLs and
 * returns the raw DER bytes plus the /VRI map keyed by sig-hash.
 *
 * Robust to malformed PDFs: returns `null` when the DSS isn't found, throws
 * `DssParseError` only when structure is present but corrupted.
 *
 * Browser-compatible. No node:* imports.
 */

import type { ParsedDss, VriEntry } from './index';

export class DssParseError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DssParseError';
  }
}

interface XrefEntry {
  offset: number;
  gen: number;
  inUse: boolean;
}

/**
 * Parse every classical xref table in a PDF (following /Prev chain) and merge
 * them so later revisions overlay earlier ones. Returns a map objNum → entry.
 */
function parseAllXrefs(text: string, bytes: Uint8Array): Map<number, XrefEntry> {
  void bytes;
  const merged = new Map<number, XrefEntry>();

  // Find ALL startxref offsets and build chain following /Prev.
  // Start from the LAST one.
  const startxrefMatches = [...text.matchAll(/startxref\s+(\d+)/g)];
  if (startxrefMatches.length === 0) {
    throw new DssParseError('bad_pdf', 'startxref not found');
  }
  let cursor: number | null = parseInt(
    startxrefMatches[startxrefMatches.length - 1]![1]!,
    10,
  );
  const visited = new Set<number>();
  const chain: number[] = [];
  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    chain.push(cursor);
    // Find /Prev in the trailer following this xref.
    const xrefStart = cursor;
    if (text.substring(xrefStart, xrefStart + 4) !== 'xref') break;
    const trailerIdx = text.indexOf('trailer', xrefStart);
    if (trailerIdx < 0) break;
    const trailerEnd = text.indexOf('startxref', trailerIdx);
    if (trailerEnd < 0) break;
    const trailerBlock = text.substring(trailerIdx, trailerEnd);
    const prevMatch = trailerBlock.match(/\/Prev\s+(\d+)/);
    cursor = prevMatch ? parseInt(prevMatch[1]!, 10) : null;
  }
  // Apply chain from OLDEST to NEWEST so newer entries overlay older.
  for (let i = chain.length - 1; i >= 0; i--) {
    applyXrefSection(text, chain[i]!, merged);
  }
  return merged;
}

function applyXrefSection(text: string, xrefStart: number, out: Map<number, XrefEntry>): void {
  if (text.substring(xrefStart, xrefStart + 4) !== 'xref') return;
  let pos = xrefStart + 4;
  // Skip newline(s).
  while (pos < text.length && (text[pos] === '\n' || text[pos] === '\r')) pos++;
  while (pos < text.length) {
    // Subsection header: `<first> <count>\n` or `trailer` marks end.
    if (text.startsWith('trailer', pos)) break;
    const lineEnd = text.indexOf('\n', pos);
    if (lineEnd < 0) break;
    const header = text.substring(pos, lineEnd).trim();
    const m = header.match(/^(\d+)\s+(\d+)$/);
    if (!m) break;
    const firstObj = parseInt(m[1]!, 10);
    const count = parseInt(m[2]!, 10);
    pos = lineEnd + 1;
    for (let i = 0; i < count; i++) {
      // Each entry is exactly 20 bytes: `nnnnnnnnnn ggggg [nf] \n`.
      const entry = text.substring(pos, pos + 20);
      pos += 20;
      const em = entry.match(/^(\d{10})\s(\d{5})\s([nf])/);
      if (!em) continue;
      const objNum = firstObj + i;
      if (objNum === 0) continue;
      out.set(objNum, {
        offset: parseInt(em[1]!, 10),
        gen: parseInt(em[2]!, 10),
        inUse: em[3]! === 'n',
      });
    }
  }
}

function findCatalogRef(text: string): { objNum: number; gen: number } | null {
  // Use the LAST trailer in file order.
  const trailerMatches = [...text.matchAll(/trailer\s*<<([\s\S]*?)>>/g)];
  if (trailerMatches.length === 0) return null;
  for (let i = trailerMatches.length - 1; i >= 0; i--) {
    const block = trailerMatches[i]![1]!;
    const rootMatch = block.match(/\/Root\s+(\d+)\s+(\d+)\s+R/);
    if (rootMatch) {
      return { objNum: parseInt(rootMatch[1]!, 10), gen: parseInt(rootMatch[2]!, 10) };
    }
  }
  return null;
}

/**
 * Read the LATEST revision body text (inside `<< ... >>`) of the indirect
 * object at `obj 0` matching the given object number. Uses xref where
 * available; falls back to text search.
 */
function readDictBody(
  text: string,
  xref: Map<number, XrefEntry>,
  objNum: number,
  gen: number,
): string | null {
  // Try xref first.
  const entry = xref.get(objNum);
  if (entry && entry.inUse) {
    const dictBody = readDictBodyAtOffset(text, entry.offset);
    if (dictBody !== null) return dictBody;
  }
  // Fallback: last textual occurrence.
  const re = new RegExp(`\\b${objNum}\\s+${gen}\\s+obj\\b`, 'g');
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1]!;
  return readDictBodyAtOffset(text, last.index!);
}

function readDictBodyAtOffset(text: string, offset: number): string | null {
  // Skip the `<n> <g> obj` header.
  const objMatch = text.substring(offset).match(/^\s*\d+\s+\d+\s+obj\b/);
  if (!objMatch) return null;
  const startSearch = offset + objMatch[0].length;
  const openIdx = text.indexOf('<<', startSearch);
  const endobjIdx = text.indexOf('endobj', startSearch);
  if (openIdx < 0 || (endobjIdx > 0 && openIdx > endobjIdx)) return null;
  let depth = 0;
  let i = openIdx;
  while (i < text.length - 1) {
    if (text[i] === '<' && text[i + 1] === '<') {
      depth++;
      i += 2;
    } else if (text[i] === '>' && text[i + 1] === '>') {
      depth--;
      if (depth === 0) return text.substring(openIdx + 2, i).trim();
      i += 2;
    } else {
      i++;
    }
  }
  return null;
}

/**
 * Parse an indirect-ref array fragment like `[1 0 R 2 0 R 3 0 R]` → [1, 2, 3].
 */
function parseRefArray(arr: string): number[] {
  const out: number[] = [];
  const re = /(\d+)\s+\d+\s+R/g;
  let m;
  while ((m = re.exec(arr)) !== null) {
    out.push(parseInt(m[1]!, 10));
  }
  return out;
}

/**
 * Locate and dereference a stream object by object number, returning the raw
 * `stream`...`endstream` body bytes (which we expect to be DER).
 */
function readStreamBytes(
  bytes: Uint8Array,
  text: string,
  xref: Map<number, XrefEntry>,
  objNum: number,
): Uint8Array | null {
  const entry = xref.get(objNum);
  let offset: number | null = null;
  if (entry && entry.inUse) {
    offset = entry.offset;
  } else {
    const re = new RegExp(`\\b${objNum}\\s+\\d+\\s+obj\\b`, 'g');
    const matches = [...text.matchAll(re)];
    if (matches.length === 0) return null;
    offset = matches[matches.length - 1]!.index!;
  }
  // Read dict to find /Length, then find `stream\n`...`\nendstream`.
  const dictBody = readDictBodyAtOffset(text, offset);
  if (dictBody === null) return null;
  const lengthMatch = dictBody.match(/\/Length\s+(\d+)/);
  if (!lengthMatch) return null;
  const length = parseInt(lengthMatch[1]!, 10);

  // Find `stream` keyword after the dict.
  // Find first `stream\n` (or `stream\r\n`) after offset.
  const streamKwIdx = text.indexOf('stream', offset);
  if (streamKwIdx < 0) return null;
  let dataStart = streamKwIdx + 'stream'.length;
  // Per spec: stream keyword may be followed by CRLF or LF (not just CR).
  if (text[dataStart] === '\r' && text[dataStart + 1] === '\n') dataStart += 2;
  else if (text[dataStart] === '\n') dataStart += 1;
  else return null;
  if (dataStart + length > bytes.length) return null;
  return bytes.slice(dataStart, dataStart + length);
}

/**
 * Parse the /VRI sub-dict and resolve each entry's indirect refs to indices in
 * the supplied object-number → array-index lookup tables.
 */
function parseVri(
  vriBody: string,
  certObjToIdx: Map<number, number>,
  ocspObjToIdx: Map<number, number>,
  crlObjToIdx: Map<number, number>,
): Record<string, VriEntry> {
  const result: Record<string, VriEntry> = {};
  // Match each /HEX << ... >> entry. Use a depth-aware scanner.
  let i = 0;
  while (i < vriBody.length) {
    // Skip whitespace.
    while (i < vriBody.length && /\s/.test(vriBody[i]!)) i++;
    if (vriBody[i] !== '/') break;
    const slashStart = i;
    i++;
    while (i < vriBody.length && /[^\s<>/]/.test(vriBody[i]!)) i++;
    const hexKey = vriBody.substring(slashStart + 1, i);
    // Skip whitespace.
    while (i < vriBody.length && /\s/.test(vriBody[i]!)) i++;
    // Expect `<<`.
    if (vriBody[i] !== '<' || vriBody[i + 1] !== '<') break;
    let depth = 1;
    const innerStart = i + 2;
    i = innerStart;
    while (i < vriBody.length - 1 && depth > 0) {
      if (vriBody[i] === '<' && vriBody[i + 1] === '<') {
        depth++;
        i += 2;
      } else if (vriBody[i] === '>' && vriBody[i + 1] === '>') {
        depth--;
        if (depth === 0) break;
        i += 2;
      } else {
        i++;
      }
    }
    const innerBody = vriBody.substring(innerStart, i);
    i += 2; // skip `>>`

    const certArr = innerBody.match(/\/Cert\s*\[([^\]]*)\]/);
    const ocspArr = innerBody.match(/\/OCSP\s*\[([^\]]*)\]/);
    const crlArr = innerBody.match(/\/CRL\s*\[([^\]]*)\]/);
    const tsRef = innerBody.match(/\/TS\s+(\d+)\s+\d+\s+R/);

    const entry: VriEntry = {
      certIndices: certArr
        ? parseRefArray(certArr[1]!)
            .map((o) => certObjToIdx.get(o))
            .filter((n): n is number => typeof n === 'number')
        : [],
      ocspIndices: ocspArr
        ? parseRefArray(ocspArr[1]!)
            .map((o) => ocspObjToIdx.get(o))
            .filter((n): n is number => typeof n === 'number')
        : [],
      crlIndices: crlArr
        ? parseRefArray(crlArr[1]!)
            .map((o) => crlObjToIdx.get(o))
            .filter((n): n is number => typeof n === 'number')
        : [],
    };
    if (tsRef) {
      const idx = ocspObjToIdx.get(parseInt(tsRef[1]!, 10));
      if (typeof idx === 'number') entry.timestampTokenIndex = idx;
    }
    result[hexKey] = entry;
  }
  return result;
}

/**
 * Extract DSS from a PDF. Returns null when no DSS is present (typical for
 * B-B / B-T PDFs).
 */
export function parseDssImpl(pdfBytes: Uint8Array): ParsedDss | null {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.length < 100) {
    return null;
  }
  let text: string;
  let xref: Map<number, XrefEntry>;
  let catalogRef: { objNum: number; gen: number } | null;
  try {
    text = new TextDecoder('latin1').decode(pdfBytes);
    xref = parseAllXrefs(text, pdfBytes);
    catalogRef = findCatalogRef(text);
  } catch {
    return null;
  }
  if (!catalogRef) return null;

  let catalogBody: string | null;
  try {
    catalogBody = readDictBody(text, xref, catalogRef.objNum, catalogRef.gen);
  } catch {
    return null;
  }
  if (!catalogBody) return null;

  const dssMatch = catalogBody.match(/\/DSS\s+(\d+)\s+(\d+)\s+R/);
  if (!dssMatch) return null;
  const dssObjNum = parseInt(dssMatch[1]!, 10);
  const dssGenNum = parseInt(dssMatch[2]!, 10);

  let dssBody: string | null;
  try {
    dssBody = readDictBody(text, xref, dssObjNum, dssGenNum);
  } catch (cause) {
    throw new DssParseError(
      'malformed',
      `DSS dict referenced but not readable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (!dssBody) {
    throw new DssParseError('malformed', `DSS object ${dssObjNum} referenced but not found`);
  }

  const certsArr = dssBody.match(/\/Certs\s*\[([^\]]*)\]/);
  const ocspsArr = dssBody.match(/\/OCSPs\s*\[([^\]]*)\]/);
  const crlsArr = dssBody.match(/\/CRLs\s*\[([^\]]*)\]/);
  const certObjs = certsArr ? parseRefArray(certsArr[1]!) : [];
  const ocspObjs = ocspsArr ? parseRefArray(ocspsArr[1]!) : [];
  const crlObjs = crlsArr ? parseRefArray(crlsArr[1]!) : [];

  // Dereference each stream.
  const certs: Uint8Array[] = [];
  for (const o of certObjs) {
    const b = readStreamBytes(pdfBytes, text, xref, o);
    if (!b) {
      throw new DssParseError('malformed', `/Certs ${o} stream missing`);
    }
    certs.push(b);
  }
  const ocsps: Uint8Array[] = [];
  for (const o of ocspObjs) {
    const b = readStreamBytes(pdfBytes, text, xref, o);
    if (!b) {
      throw new DssParseError('malformed', `/OCSPs ${o} stream missing`);
    }
    ocsps.push(b);
  }
  const crls: Uint8Array[] = [];
  for (const o of crlObjs) {
    const b = readStreamBytes(pdfBytes, text, xref, o);
    if (!b) {
      throw new DssParseError('malformed', `/CRLs ${o} stream missing`);
    }
    crls.push(b);
  }

  // Build obj-num → index lookup for VRI resolution.
  const certObjToIdx = new Map<number, number>();
  certObjs.forEach((o, i) => certObjToIdx.set(o, i));
  const ocspObjToIdx = new Map<number, number>();
  ocspObjs.forEach((o, i) => ocspObjToIdx.set(o, i));
  const crlObjToIdx = new Map<number, number>();
  crlObjs.forEach((o, i) => crlObjToIdx.set(o, i));

  // Parse /VRI sub-dict.
  let vri: Record<string, VriEntry> = {};
  const vriIdx = dssBody.indexOf('/VRI');
  if (vriIdx >= 0) {
    // Find the matching << ... >> after /VRI.
    let p = vriIdx + 4;
    while (p < dssBody.length && /\s/.test(dssBody[p]!)) p++;
    if (dssBody[p] === '<' && dssBody[p + 1] === '<') {
      let depth = 1;
      const innerStart = p + 2;
      p = innerStart;
      while (p < dssBody.length - 1 && depth > 0) {
        if (dssBody[p] === '<' && dssBody[p + 1] === '<') {
          depth++;
          p += 2;
        } else if (dssBody[p] === '>' && dssBody[p + 1] === '>') {
          depth--;
          if (depth === 0) break;
          p += 2;
        } else {
          p++;
        }
      }
      const vriBody = dssBody.substring(innerStart, p);
      vri = parseVri(vriBody, certObjToIdx, ocspObjToIdx, crlObjToIdx);
    }
  }

  return { certs, ocsps, crls, vri };
}
