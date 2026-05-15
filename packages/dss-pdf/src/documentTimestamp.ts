/**
 * Document timestamp writer + extractor (B-LTA path).
 *
 * Appends a `/Sig` dict with `/SubFilter /ETSI.RFC3161` whose `/Contents` is
 * directly the RFC 3161 TimeStampToken DER (no PKCS#7 wrapper — the token IS
 * the signature). The `/ByteRange` covers the entire prior PDF except the
 * /Contents hex window itself.
 *
 * Pipeline (per spec §2.3):
 *   1. Allocate three new objects: Sig dict (doc-ts), invisible Widget annot,
 *      empty FormXObject /AP.
 *   2. Allocate updated revisions of: Catalog, AcroForm, first Page.
 *   3. Emit incremental tail with placeholder /ByteRange `**********` and a
 *      `<0...0>` /Contents window sized for the token (default 16384 hex
 *      chars = 8192 DER bytes — FreeTSA tokens are ~3 KB).
 *   4. Locate the /ByteRange + /Contents window in the assembled output and
 *      compute the real /ByteRange `[0, ltOff, gtOff+1, fileLen - gtOff - 1]`.
 *   5. Hash the byteRange-covered bytes (SHA-256), call
 *      `@firma-ec/tsa-client.requestTimestamp(imprint)` to obtain the token.
 *   6. Hex-encode the token DER and write into the /Contents hex window.
 *
 * Browser-compatible. No node:* imports.
 *
 * @see docs/superpowers/specs/2026-05-10-firma-ec-F7-LTV-design.md §2.3 + §4.2
 */

import { requestTimestamp } from '@firma-ec/tsa-client';
import type { AppendDocumentTimestampOpts, DocumentTimestampInfo } from './index';

export class DocTimestampWriteError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DocTimestampWriteError';
  }
}

const SUBFILTER_DOC_TIMESTAMP = 'ETSI.RFC3161';
const DEFAULT_TOKEN_LENGTH_HEX = 16384; // 8192 DER bytes — FreeTSA tokens ~3 KB
const DEFAULT_TIMEOUT_MS = 8000;

interface PriorPdfInfo {
  prevXrefOffset: number;
  size: number;
  catalogObjNum: number;
  catalogGenNum: number;
  catalogInnerBody: string;
  acroFormObjNum: number | null;
  acroFormGenNum: number;
  acroFormFieldsBody: string;
  acroFormSigFlags: number;
  firstPageObjNum: number;
  firstPageGenNum: number;
  firstPageBody: string;
}

function parsePriorPdf(pdf: Uint8Array): PriorPdfInfo {
  const text = new TextDecoder('latin1').decode(pdf);

  const startxrefMatches = [...text.matchAll(/startxref\s+(\d+)/g)];
  if (startxrefMatches.length === 0) {
    throw new DocTimestampWriteError('bad_pdf', 'startxref not found');
  }
  const prevXrefOffset = Number.parseInt(startxrefMatches[startxrefMatches.length - 1]![1]!, 10);

  if (text.substring(prevXrefOffset, prevXrefOffset + 4) !== 'xref') {
    throw new DocTimestampWriteError(
      'xref_stream_unsupported',
      `xref at ${prevXrefOffset} is not classical`,
    );
  }

  const trailerIdx = text.indexOf('trailer', prevXrefOffset);
  if (trailerIdx < 0) throw new DocTimestampWriteError('bad_pdf', 'trailer not found');
  const trailerEnd = text.indexOf('startxref', trailerIdx);
  if (trailerEnd < 0) throw new DocTimestampWriteError('bad_pdf', 'trailer end not found');
  const trailerBlock = text.substring(trailerIdx, trailerEnd);

  const sizeMatch = trailerBlock.match(/\/Size\s+(\d+)/);
  if (!sizeMatch) throw new DocTimestampWriteError('bad_pdf', '/Size missing');
  const size = Number.parseInt(sizeMatch[1]!, 10);

  const rootMatch = trailerBlock.match(/\/Root\s+(\d+)\s+(\d+)\s+R/);
  if (!rootMatch) throw new DocTimestampWriteError('bad_pdf', '/Root missing');
  const catalogObjNum = Number.parseInt(rootMatch[1]!, 10);
  const catalogGenNum = Number.parseInt(rootMatch[2]!, 10);
  const catalogInnerBody = readLastDictBody(text, catalogObjNum, catalogGenNum);
  if (!catalogInnerBody) {
    throw new DocTimestampWriteError('bad_pdf', 'Catalog body not found');
  }

  // AcroForm.
  const acroFormMatch = catalogInnerBody.match(/\/AcroForm\s+(\d+)\s+(\d+)\s+R/);
  let acroFormObjNum: number | null = null;
  let acroFormGenNum = 0;
  let acroFormFieldsBody = '';
  let acroFormSigFlags = 0;
  if (acroFormMatch) {
    acroFormObjNum = Number.parseInt(acroFormMatch[1]!, 10);
    acroFormGenNum = Number.parseInt(acroFormMatch[2]!, 10);
    const afBody = readLastDictBody(text, acroFormObjNum, acroFormGenNum);
    if (afBody) {
      const fields = afBody.match(/\/Fields\s*\[([^\]]*)\]/);
      if (fields) acroFormFieldsBody = fields[1]!.trim();
      const sf = afBody.match(/\/SigFlags\s+(\d+)/);
      if (sf) acroFormSigFlags = Number.parseInt(sf[1]!, 10);
    }
  }

  // First page via Pages → Kids.
  const pagesMatch = catalogInnerBody.match(/\/Pages\s+(\d+)\s+(\d+)\s+R/);
  if (!pagesMatch) throw new DocTimestampWriteError('bad_pdf', '/Pages missing in Catalog');
  const pagesObjNum = Number.parseInt(pagesMatch[1]!, 10);
  const pagesGenNum = Number.parseInt(pagesMatch[2]!, 10);
  const pagesBody = readLastDictBody(text, pagesObjNum, pagesGenNum);
  if (!pagesBody) throw new DocTimestampWriteError('bad_pdf', 'Pages body not found');
  const kidsMatch = pagesBody.match(/\/Kids\s*\[([^\]]*)\]/);
  if (!kidsMatch) throw new DocTimestampWriteError('bad_pdf', '/Kids missing');
  const firstKidMatch = kidsMatch[1]!.match(/(\d+)\s+(\d+)\s+R/);
  if (!firstKidMatch) throw new DocTimestampWriteError('bad_pdf', 'no first kid');
  const firstPageObjNum = Number.parseInt(firstKidMatch[1]!, 10);
  const firstPageGenNum = Number.parseInt(firstKidMatch[2]!, 10);
  const firstPageBody = readLastDictBody(text, firstPageObjNum, firstPageGenNum);
  if (!firstPageBody) {
    throw new DocTimestampWriteError('bad_pdf', 'first page body not found');
  }

  return {
    prevXrefOffset,
    size,
    catalogObjNum,
    catalogGenNum,
    catalogInnerBody,
    acroFormObjNum,
    acroFormGenNum,
    acroFormFieldsBody,
    acroFormSigFlags,
    firstPageObjNum,
    firstPageGenNum,
    firstPageBody,
  };
}

function readLastDictBody(text: string, objNum: number, genNum: number): string | null {
  const re = new RegExp(`\\b${objNum}\\s+${genNum}\\s+obj\\b`, 'g');
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1]!;
  const startSearch = last.index! + last[0].length;
  const openIdx = text.indexOf('<<', startSearch);
  if (openIdx < 0) return null;
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

function injectAnnotIntoPage(pageBody: string, widgetRef: string): string {
  const annotsLit = pageBody.match(/\/Annots\s*\[([^\]]*)\]/);
  if (annotsLit) {
    const inner = annotsLit[1]!.trim();
    return pageBody.replace(
      annotsLit[0],
      `/Annots [${inner.length > 0 ? inner + ' ' : ''}${widgetRef}]`,
    );
  }
  const annotsIndirect = pageBody.match(/\/Annots\s+(\d+)\s+(\d+)\s+R/);
  if (annotsIndirect) {
    return pageBody.replace(
      annotsIndirect[0],
      `/Annots [${annotsIndirect[1]} ${annotsIndirect[2]} R ${widgetRef}]`,
    );
  }
  return pageBody.trim() + ` /Annots [${widgetRef}]`;
}

function buildXrefTable(offsets: Map<number, { offset: number; gen: number }>): string {
  const touched = [...offsets.entries()].sort((a, b) => a[0] - b[0]);
  let out = `xref\n0 1\n0000000000 65535 f \n`;
  let i = 0;
  while (i < touched.length) {
    const startObj = touched[i]![0];
    let j = i;
    while (j + 1 < touched.length && touched[j + 1]![0] === touched[j]![0] + 1) {
      j++;
    }
    out += `${startObj} ${j - i + 1}\n`;
    for (let k = i; k <= j; k++) {
      const [, e] = touched[k]!;
      out += `${e.offset.toString().padStart(10, '0')} ${e.gen.toString().padStart(5, '0')} n \n`;
    }
    i = j + 1;
  }
  return out;
}

/**
 * Append a document timestamp /Sig dict. Returns the augmented PDF bytes
 * (B-LTA) plus TSA metadata. On TSA failure, returns `{ ok: false, ... }` and
 * the input is unchanged.
 */
export async function appendDocumentTimestampImpl(
  opts: AppendDocumentTimestampOpts,
): Promise<
  | { ok: true; pdfBytes: Uint8Array; tsaIssuerCN: string; signingTime: Date }
  | { ok: false; reason: string; detail?: string }
> {
  const { pdfBytes } = opts;
  const tsaUrl = opts.tsaUrl;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.length < 100) {
    return { ok: false, reason: 'bad_input' };
  }

  let info: PriorPdfInfo;
  try {
    info = parsePriorPdf(pdfBytes);
  } catch (cause) {
    return {
      ok: false,
      reason: 'bad_pdf',
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }

  // Allocate object numbers.
  let nextObj = info.size;
  const sigObjNum = nextObj++;
  const widgetObjNum = nextObj++;
  const apObjNum = nextObj++;
  let acroFormObjNum: number;
  let acroFormGenNum = 0;
  if (info.acroFormObjNum !== null) {
    acroFormObjNum = info.acroFormObjNum;
    acroFormGenNum = info.acroFormGenNum;
  } else {
    acroFormObjNum = nextObj++;
  }
  const newCatalogGen = info.catalogGenNum;
  const newPageGen = info.firstPageGenNum;

  const enc = new TextEncoder();
  const tokenHexLen = DEFAULT_TOKEN_LENGTH_HEX;
  const byteRangePlaceholder = '[ 0 **********0 **********0 **********0 ]';
  const contentsPlaceholder = '<' + '0'.repeat(tokenHexLen) + '>';

  // Build all object texts.
  const sigObjText =
    `${sigObjNum} 0 obj\n` +
    `<<\n` +
    `/Type /DocTimeStamp\n` +
    `/Filter /Adobe.PPKLite\n` +
    `/SubFilter /${SUBFILTER_DOC_TIMESTAMP}\n` +
    `/ByteRange ${byteRangePlaceholder}\n` +
    `/Contents ${contentsPlaceholder}\n` +
    `>>\n` +
    `endobj\n`;

  const apBody = `q\nQ\n`;
  const apObjText =
    `${apObjNum} 0 obj\n` +
    `<< /Type /XObject /Subtype /Form /BBox [0 0 0 0] /Resources << >> /Length ${apBody.length} >>\n` +
    `stream\n${apBody}endstream\n` +
    `endobj\n`;

  const widgetObjText =
    `${widgetObjNum} 0 obj\n` +
    `<<\n` +
    `/Type /Annot\n` +
    `/Subtype /Widget\n` +
    `/FT /Sig\n` +
    `/Rect [0 0 0 0]\n` +
    `/V ${sigObjNum} 0 R\n` +
    `/T (doc-ts)\n` +
    `/F 132\n` +
    `/P ${info.firstPageObjNum} ${info.firstPageGenNum} R\n` +
    `/AP << /N ${apObjNum} 0 R >>\n` +
    `>>\n` +
    `endobj\n`;

  const newSigFlags = info.acroFormSigFlags | 3;
  const fieldsBody =
    info.acroFormFieldsBody.length > 0
      ? `${info.acroFormFieldsBody} ${widgetObjNum} 0 R`
      : `${widgetObjNum} 0 R`;
  const acroFormObjText =
    `${acroFormObjNum} ${acroFormGenNum} obj\n` +
    `<< /Fields [${fieldsBody}] /SigFlags ${newSigFlags} >>\n` +
    `endobj\n`;

  // Catalog: preserve existing entries, ensure /AcroForm → acroFormObjNum.
  const catalogBodyNoAf = info.catalogInnerBody.replace(/\/AcroForm\s+\d+\s+\d+\s+R/, '');
  const catalogObjText =
    `${info.catalogObjNum} ${newCatalogGen} obj\n` +
    `<< ${catalogBodyNoAf} /AcroForm ${acroFormObjNum} ${acroFormGenNum} R >>\n` +
    `endobj\n`;

  // Page: add widget ref to /Annots.
  const newPageBody = injectAnnotIntoPage(info.firstPageBody, `${widgetObjNum} 0 R`);
  const pageObjText =
    `${info.firstPageObjNum} ${newPageGen} obj\n` + `<< ${newPageBody} >>\n` + `endobj\n`;

  // Note: readLastDictBody returns the body inside `<< >>`, so we re-wrap above.

  // Lay out in order: sig, ap, widget, acroForm, catalog, page.
  const needsSep = pdfBytes[pdfBytes.length - 1] !== 0x0a;
  const sepBytes = needsSep ? enc.encode('\n') : new Uint8Array(0);

  const inputLen = pdfBytes.length;
  let cursor = inputLen + sepBytes.length;

  const offsets = new Map<number, { offset: number; gen: number }>();
  const parts: Uint8Array[] = [];

  const sigBytes = enc.encode(sigObjText);
  offsets.set(sigObjNum, { offset: cursor, gen: 0 });
  cursor += sigBytes.length;
  parts.push(sigBytes);

  const apBytes = enc.encode(apObjText);
  offsets.set(apObjNum, { offset: cursor, gen: 0 });
  cursor += apBytes.length;
  parts.push(apBytes);

  const widgetBytes = enc.encode(widgetObjText);
  offsets.set(widgetObjNum, { offset: cursor, gen: 0 });
  cursor += widgetBytes.length;
  parts.push(widgetBytes);

  const acroFormBytes = enc.encode(acroFormObjText);
  offsets.set(acroFormObjNum, { offset: cursor, gen: acroFormGenNum });
  cursor += acroFormBytes.length;
  parts.push(acroFormBytes);

  const catalogBytes = enc.encode(catalogObjText);
  offsets.set(info.catalogObjNum, { offset: cursor, gen: newCatalogGen });
  cursor += catalogBytes.length;
  parts.push(catalogBytes);

  const pageBytes = enc.encode(pageObjText);
  offsets.set(info.firstPageObjNum, { offset: cursor, gen: newPageGen });
  cursor += pageBytes.length;
  parts.push(pageBytes);

  const xrefOffset = cursor;
  const xrefText = buildXrefTable(offsets);
  const newSize = nextObj;
  const trailerText =
    `trailer\n` +
    `<< /Size ${newSize} ` +
    `/Root ${info.catalogObjNum} ${newCatalogGen} R ` +
    `/Prev ${info.prevXrefOffset} >>\n` +
    `startxref\n${xrefOffset}\n` +
    `%%EOF\n`;
  const tailMetaBytes = enc.encode(xrefText + trailerText);

  // Concatenate everything (with placeholders still in place).
  let totalLen = inputLen + sepBytes.length;
  for (const p of parts) totalLen += p.length;
  totalLen += tailMetaBytes.length;

  const out = new Uint8Array(totalLen);
  let off = 0;
  out.set(pdfBytes, off);
  off += inputLen;
  out.set(sepBytes, off);
  off += sepBytes.length;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  out.set(tailMetaBytes, off);

  // Locate /ByteRange + /Contents in the freshly-appended tail.
  const window = locateNewSigWindow(out, inputLen);

  const realByteRange: [number, number, number, number] = [
    0,
    window.contentsHexStart - 1, // ltOffset = '<' position
    window.contentsHexEnd + 1, // gtOffset + 1
    out.length - (window.contentsHexEnd + 1),
  ];
  const brStr = `[ ${realByteRange[0]} ${realByteRange[1]} ${realByteRange[2]} ${realByteRange[3]} ]`;
  if (brStr.length > window.byteRangeSlotLen) {
    return {
      ok: false,
      reason: 'malformed',
      detail: `ByteRange str ${brStr.length} > slot ${window.byteRangeSlotLen}`,
    };
  }
  const brPadded = brStr.padEnd(window.byteRangeSlotLen, ' ');
  out.set(enc.encode(brPadded), window.byteRangeSlotStart);

  // Hash the covered bytes (SHA-256).
  const [a, b, c, d] = realByteRange;
  const covered = new Uint8Array(b + d);
  covered.set(out.subarray(a, a + b), 0);
  covered.set(out.subarray(c, c + d), b);
  const imprint = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      covered.buffer.slice(
        covered.byteOffset,
        covered.byteOffset + covered.byteLength,
      ) as ArrayBuffer,
    ),
  );

  // Request the timestamp.
  let tsResult;
  try {
    tsResult = await requestTimestamp(imprint, {
      ...(tsaUrl ? { url: tsaUrl } : {}),
      timeoutMs,
      hashAlgo: 'SHA-256',
    });
  } catch (cause) {
    return {
      ok: false,
      reason: 'network',
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }
  if ('error' in tsResult) {
    return {
      ok: false,
      reason: tsResult.error,
      ...(tsResult.detail !== undefined ? { detail: tsResult.detail } : {}),
    };
  }

  const tokenDer = tsResult.token;
  const reservedHexLen = window.contentsHexEnd - window.contentsHexStart;
  const tokenHex = bytesToHex(tokenDer);
  if (tokenHex.length > reservedHexLen) {
    return {
      ok: false,
      reason: 'malformed',
      detail: `token DER (${tokenDer.length} bytes) exceeds reserved /Contents window (${reservedHexLen / 2} bytes)`,
    };
  }
  const tokenHexPadded = tokenHex.padEnd(reservedHexLen, '0');
  out.set(enc.encode(tokenHexPadded), window.contentsHexStart);

  return {
    ok: true,
    pdfBytes: out,
    tsaIssuerCN: tsResult.tsaCert?.subjectCN ?? '',
    signingTime: tsResult.signingTime,
  };
}

interface NewSigWindow {
  byteRangeSlotStart: number;
  byteRangeSlotLen: number;
  contentsHexStart: number;
  contentsHexEnd: number;
}

function locateNewSigWindow(out: Uint8Array, searchFrom: number): NewSigWindow {
  const text = new TextDecoder('latin1').decode(out);
  const brIdx = text.indexOf('/ByteRange [ 0 **********0', searchFrom);
  if (brIdx < 0) throw new DocTimestampWriteError('internal', '/ByteRange placeholder not found');
  const openBr = text.indexOf('[', brIdx);
  const closeBr = text.indexOf(']', openBr);
  if (openBr < 0 || closeBr < 0) {
    throw new DocTimestampWriteError('internal', '/ByteRange brackets not found');
  }
  const ctIdx = text.indexOf('/Contents', closeBr);
  if (ctIdx < 0) throw new DocTimestampWriteError('internal', '/Contents not found');
  let i = ctIdx + '/Contents'.length;
  while (i < out.length) {
    const b = out[i]!;
    if (b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) break;
    i++;
  }
  if (out[i] !== 0x3c) {
    throw new DocTimestampWriteError(
      'internal',
      `expected '<' at /Contents start, got 0x${(out[i] ?? 0).toString(16)}`,
    );
  }
  const ltOffset = i;
  let j = i + 1;
  while (j < out.length && out[j] !== 0x3e) j++;
  if (j >= out.length) throw new DocTimestampWriteError('internal', '> not found');
  return {
    byteRangeSlotStart: openBr,
    byteRangeSlotLen: closeBr - openBr + 1,
    contentsHexStart: ltOffset + 1,
    contentsHexEnd: j,
  };
}

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, '0');
  return s;
}

/**
 * Find all `/Sig` dicts where `subFilter === ETSI.RFC3161` (document timestamps).
 *
 * @returns Array of `{ byteRange, tokenDer, coveredBytes }`. Empty when none.
 */
export function findDocumentTimestampsImpl(pdfBytes: Uint8Array): DocumentTimestampInfo[] {
  const results: DocumentTimestampInfo[] = [];
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.length < 100) return results;

  const text = new TextDecoder('latin1').decode(pdfBytes);
  // Find every dict that contains `/SubFilter /ETSI.RFC3161` AND a /ByteRange.
  // Iterate over each indirect object header so we can extract per-object body.
  const objRe = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = objRe.exec(text)) !== null) {
    const objStart = m.index;
    const endobjIdx = text.indexOf('endobj', objStart);
    if (endobjIdx < 0) continue;
    const body = text.substring(objStart, endobjIdx);
    if (!body.includes(`/SubFilter /${SUBFILTER_DOC_TIMESTAMP}`)) continue;
    const brMatch = body.match(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
    if (!brMatch) continue;
    const a = Number.parseInt(brMatch[1]!, 10);
    const b = Number.parseInt(brMatch[2]!, 10);
    const c = Number.parseInt(brMatch[3]!, 10);
    const d = Number.parseInt(brMatch[4]!, 10);
    if (c + d > pdfBytes.length || a + b > pdfBytes.length) continue;
    // Find /Contents < ... > in this body and extract bytes.
    const ctIdx = body.indexOf('/Contents');
    if (ctIdx < 0) continue;
    const ltRel = body.indexOf('<', ctIdx);
    const gtRel = body.indexOf('>', ltRel);
    if (ltRel < 0 || gtRel < 0) continue;
    const hex = body.substring(ltRel + 1, gtRel).replace(/[\s\n\r]/g, '');
    // Strip trailing zero padding.
    const trimmed = hex.replace(/0+$/, '');
    const finalHex = trimmed.length % 2 === 0 ? trimmed : trimmed + '0';
    const tokenDer = hexToBytes(finalHex);
    const covered = new Uint8Array(b + d);
    covered.set(pdfBytes.subarray(a, a + b), 0);
    covered.set(pdfBytes.subarray(c, c + d), b);
    results.push({
      byteRange: [a, b, c, d],
      tokenDer,
      coveredBytes: covered,
    });
  }
  return results;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}
