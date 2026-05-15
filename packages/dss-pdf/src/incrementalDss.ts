/**
 * Incremental update writer that appends a DSS dictionary on top of an
 * existing B-T PDF.
 *
 * Pipeline (per spec §2.2):
 *   1. Parse the prior xref/trailer to learn: prev xref offset, /Size,
 *      /Root (Catalog ref) and the Catalog dict body.
 *   2. Allocate object numbers: N cert streams + M OCSP streams + K CRL streams
 *      + 1 DSS dict.
 *   3. Serialize stream bytes (uncompressed DER), measuring offsets so the
 *      xref table can point to them precisely.
 *   4. Serialize the DSS dict referencing every stream + the per-signature
 *      VRI sub-dict.
 *   5. Serialize an updated Catalog (same obj number, bumped generation) that
 *      keeps every existing entry and adds `/DSS <dssRef>`.
 *   6. Emit a classical xref table with one subsection per touched object run
 *      + a trailer that carries `/Prev <oldXrefOff>`.
 *   7. Concatenate: `pdfBytes ‖ ['\n' if missing] ‖ streams ‖ dssDict ‖
 *      updatedCatalog ‖ xref ‖ trailer ‖ startxref ‖ %%EOF`.
 *
 * Slice-1 invariant: bytes [0..pdfBytes.length) are returned untouched, so the
 * prior /Sig dict's `/ByteRange` still covers the same bytes and verifies.
 *
 * Browser-compatible. No node:* imports.
 *
 * @see docs/superpowers/specs/2026-05-10-firma-ec-F7-LTV-design.md §2.2 + §4.2
 */

import { type DssDictRefs, serializeDssDict } from './dictionary';
import type { AppendDssOpts, DssData, VriEntry } from './index';
import { serializeStreams } from './streams';

export class DssWriteError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DssWriteError';
  }
}

interface PriorPdfInfo {
  prevXrefOffset: number;
  size: number;
  catalogObjNum: number;
  catalogGenNum: number;
  /** Body text between `<<` and `>>` of the latest Catalog revision. */
  catalogInnerBody: string;
}

/**
 * Parse the last `startxref` + classical xref table + trailer of a PDF to
 * extract the structural refs we need to emit an incremental update.
 *
 * Mirrors the helper in signer/incrementalUpdate.ts but lives here so dss-pdf
 * doesn't depend on signer (which depends on us).
 */
function parsePriorPdf(pdf: Uint8Array): PriorPdfInfo {
  const text = new TextDecoder('latin1').decode(pdf);

  const startxrefMatches = [...text.matchAll(/startxref\s+(\d+)/g)];
  if (startxrefMatches.length === 0) {
    throw new DssWriteError('bad_pdf', 'startxref not found');
  }
  const lastSx = startxrefMatches[startxrefMatches.length - 1]!;
  const prevXrefOffset = Number.parseInt(lastSx[1]!, 10);

  if (text.substring(prevXrefOffset, prevXrefOffset + 4) !== 'xref') {
    throw new DssWriteError(
      'xref_stream_unsupported',
      `xref at offset ${prevXrefOffset} is not classical (xref streams unsupported in F7)`,
    );
  }

  const trailerIdx = text.indexOf('trailer', prevXrefOffset);
  if (trailerIdx < 0) throw new DssWriteError('bad_pdf', 'trailer not found after xref');
  const trailerEnd = text.indexOf('startxref', trailerIdx);
  if (trailerEnd < 0) throw new DssWriteError('bad_pdf', 'trailer end (startxref) not found');
  const trailerBlock = text.substring(trailerIdx, trailerEnd);

  const sizeMatch = trailerBlock.match(/\/Size\s+(\d+)/);
  if (!sizeMatch) throw new DssWriteError('bad_pdf', '/Size missing in trailer');
  const size = Number.parseInt(sizeMatch[1]!, 10);

  const rootMatch = trailerBlock.match(/\/Root\s+(\d+)\s+(\d+)\s+R/);
  if (!rootMatch) throw new DssWriteError('bad_pdf', '/Root missing in trailer');
  const catalogObjNum = Number.parseInt(rootMatch[1]!, 10);
  const catalogGenNum = Number.parseInt(rootMatch[2]!, 10);

  // Read latest Catalog body (between `<<` and matching `>>`).
  const catalogInnerBody = readLastIndirectDictBody(text, catalogObjNum, catalogGenNum);
  if (catalogInnerBody === null) {
    throw new DssWriteError('bad_pdf', `Catalog object ${catalogObjNum} not found`);
  }

  return { prevXrefOffset, size, catalogObjNum, catalogGenNum, catalogInnerBody };
}

/**
 * Read the LATEST revision of an indirect dict object's body (the text inside
 * the outermost `<< ... >>`). Returns null when not found.
 *
 * Handles nested `<<` / `>>` via depth counting.
 */
function readLastIndirectDictBody(text: string, objNum: number, genNum: number): string | null {
  const re = new RegExp(`\\b${objNum}\\s+${genNum}\\s+obj\\b`, 'g');
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1]!;
  const startSearch = last.index! + last[0].length;
  // Find first `<<` after the obj header.
  const openIdx = text.indexOf('<<', startSearch);
  if (openIdx < 0) return null;
  // Match nested `<<` / `>>` correctly.
  let depth = 0;
  let i = openIdx;
  while (i < text.length - 1) {
    if (text[i] === '<' && text[i + 1] === '<') {
      depth++;
      i += 2;
      continue;
    }
    if (text[i] === '>' && text[i + 1] === '>') {
      depth--;
      if (depth === 0) {
        return text.substring(openIdx + 2, i).trim();
      }
      i += 2;
      continue;
    }
    i++;
  }
  return null;
}

/**
 * Add `/DSS <ref>` to the Catalog body, preserving every existing entry.
 *
 * If `/DSS` already exists (e.g. signing twice with LT), it is replaced —
 * Adobe Reader behaves the same way (latest revision wins).
 */
function injectDssIntoCatalog(catalogBody: string, dssObjNum: number): string {
  const dssEntry = `/DSS ${dssObjNum} 0 R`;
  const dssMatch = catalogBody.match(/\/DSS\s+\d+\s+\d+\s+R/);
  if (dssMatch) {
    return catalogBody.replace(dssMatch[0], dssEntry);
  }
  return catalogBody.trim() + ` ${dssEntry}`;
}

/**
 * Build the xref table covering only the touched objects.
 * Always emits obj-0 as the free-sentinel subsection.
 */
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
    const count = j - i + 1;
    out += `${startObj} ${count}\n`;
    for (let k = i; k <= j; k++) {
      const [, entry] = touched[k]!;
      out += `${entry.offset.toString().padStart(10, '0')} ${entry.gen
        .toString()
        .padStart(5, '0')} n \n`;
    }
    i = j + 1;
  }
  return out;
}

/**
 * Append a DSS dictionary on top of a B-T PDF.
 *
 * @returns Output PDF bytes (B-LT). `output.subarray(0, input.length)` equals
 *          the input byte-for-byte.
 */
export async function appendDssImpl(opts: AppendDssOpts): Promise<Uint8Array> {
  const { pdfBytes, dss } = opts;
  if (!(pdfBytes instanceof Uint8Array)) {
    throw new DssWriteError('bad_input', 'pdfBytes must be Uint8Array');
  }
  if (pdfBytes.length < 100) {
    throw new DssWriteError('bad_input', 'pdfBytes too small to be a PDF');
  }
  validateDssData(dss);

  const info = parsePriorPdf(pdfBytes);

  // Allocate object numbers: cert streams, ocsp streams, crl streams, dss dict.
  const nCerts = dss.certs.length;
  const nOcsps = dss.ocsps.length;
  const nCrls = dss.crls.length;
  let nextObj = info.size;
  const certStartObj = nextObj;
  nextObj += nCerts;
  const ocspStartObj = nextObj;
  nextObj += nOcsps;
  const crlStartObj = nextObj;
  nextObj += nCrls;
  const dssObjNum = nextObj;
  nextObj += 1;

  // Ensure separation between input and tail (input may not end with newline).
  const enc = new TextEncoder();
  const needsSep = pdfBytes[pdfBytes.length - 1] !== 0x0a;
  const sepBytes = needsSep ? enc.encode('\n') : new Uint8Array(0);

  const inputLen = pdfBytes.length;
  let cursor = inputLen + sepBytes.length;

  // Serialize cert streams.
  const certStreams = serializeStreams(dss.certs, certStartObj, cursor);
  cursor += certStreams.bytes.length;

  // Serialize OCSP streams.
  const ocspStreams = serializeStreams(dss.ocsps, ocspStartObj, cursor);
  cursor += ocspStreams.bytes.length;

  // Serialize CRL streams.
  const crlStreams = serializeStreams(dss.crls, crlStartObj, cursor);
  cursor += crlStreams.bytes.length;

  // Build DSS dict referencing the stream object numbers.
  const dssRefs: DssDictRefs = {
    certObjNums: certStreams.objNums,
    ocspObjNums: ocspStreams.objNums,
    crlObjNums: crlStreams.objNums,
    vri: dss.vri,
  };
  const dssDictBytes = serializeDssDict(dssObjNum, dssRefs);
  const dssDictOffset = cursor;
  cursor += dssDictBytes.length;

  // Build updated Catalog with `/DSS <ref>` added.
  const updatedCatalogBody = injectDssIntoCatalog(info.catalogInnerBody, dssObjNum);
  const newCatalogGen = info.catalogGenNum; // PDF spec doesn't strictly require bumping
  const catalogObjText =
    `${info.catalogObjNum} ${newCatalogGen} obj\n` + `<< ${updatedCatalogBody} >>\n` + `endobj\n`;
  const catalogBytes = enc.encode(catalogObjText);
  const catalogOffset = cursor;
  cursor += catalogBytes.length;

  // Build xref table.
  const offsets = new Map<number, { offset: number; gen: number }>();
  for (let i = 0; i < certStreams.objNums.length; i++) {
    offsets.set(certStreams.objNums[i]!, { offset: certStreams.offsets[i]!, gen: 0 });
  }
  for (let i = 0; i < ocspStreams.objNums.length; i++) {
    offsets.set(ocspStreams.objNums[i]!, { offset: ocspStreams.offsets[i]!, gen: 0 });
  }
  for (let i = 0; i < crlStreams.objNums.length; i++) {
    offsets.set(crlStreams.objNums[i]!, { offset: crlStreams.offsets[i]!, gen: 0 });
  }
  offsets.set(dssObjNum, { offset: dssDictOffset, gen: 0 });
  offsets.set(info.catalogObjNum, { offset: catalogOffset, gen: newCatalogGen });

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

  // Concatenate everything.
  const totalLen =
    inputLen +
    sepBytes.length +
    certStreams.bytes.length +
    ocspStreams.bytes.length +
    crlStreams.bytes.length +
    dssDictBytes.length +
    catalogBytes.length +
    tailMetaBytes.length;

  const out = new Uint8Array(totalLen);
  let off = 0;
  out.set(pdfBytes, off);
  off += inputLen;
  out.set(sepBytes, off);
  off += sepBytes.length;
  out.set(certStreams.bytes, off);
  off += certStreams.bytes.length;
  out.set(ocspStreams.bytes, off);
  off += ocspStreams.bytes.length;
  out.set(crlStreams.bytes, off);
  off += crlStreams.bytes.length;
  out.set(dssDictBytes, off);
  off += dssDictBytes.length;
  out.set(catalogBytes, off);
  off += catalogBytes.length;
  out.set(tailMetaBytes, off);
  off += tailMetaBytes.length;

  if (off !== totalLen) {
    throw new DssWriteError('internal', `assembly cursor mismatch: ${off} vs ${totalLen}`);
  }
  return out;
}

function validateDssData(dss: DssData): void {
  if (!dss || typeof dss !== 'object') {
    throw new DssWriteError('bad_input', 'dss must be an object');
  }
  if (!Array.isArray(dss.certs)) throw new DssWriteError('bad_input', 'dss.certs must be array');
  if (!Array.isArray(dss.ocsps)) throw new DssWriteError('bad_input', 'dss.ocsps must be array');
  if (!Array.isArray(dss.crls)) throw new DssWriteError('bad_input', 'dss.crls must be array');
  if (!dss.vri || typeof dss.vri !== 'object') {
    throw new DssWriteError('bad_input', 'dss.vri must be object');
  }
  for (const arr of [dss.certs, dss.ocsps, dss.crls]) {
    for (const b of arr) {
      if (!(b instanceof Uint8Array)) {
        throw new DssWriteError('bad_input', 'DSS stream entries must be Uint8Array');
      }
    }
  }
  // Validate VRI indices are in range.
  const nCerts = dss.certs.length;
  const nOcsps = dss.ocsps.length;
  const nCrls = dss.crls.length;
  for (const [hex, entry] of Object.entries(dss.vri)) {
    if (!/^[0-9A-F]+$/.test(hex)) {
      throw new DssWriteError('bad_input', `VRI key ${hex} must be uppercase hex`);
    }
    validateIndices(entry.certIndices, nCerts, `vri[${hex}].certIndices`);
    validateIndices(entry.ocspIndices, nOcsps, `vri[${hex}].ocspIndices`);
    validateIndices(entry.crlIndices, nCrls, `vri[${hex}].crlIndices`);
    if (entry.timestampTokenIndex !== undefined) {
      validateIndices([entry.timestampTokenIndex], nOcsps, `vri[${hex}].timestampTokenIndex`);
    }
  }
}

function validateIndices(idx: number[], cap: number, label: string): void {
  for (const i of idx) {
    if (!Number.isInteger(i) || i < 0 || i >= cap) {
      throw new DssWriteError('bad_input', `${label}: index ${i} out of range [0, ${cap})`);
    }
  }
}

export type { VriEntry };
