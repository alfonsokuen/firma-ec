/**
 * Incremental update path for multi-firma secuencial.
 *
 * Approach (manual, no pdf-lib `save()`):
 *   - Take `signedPdfBytes` AS-IS — its bytes [0..fileEnd) become slice 1 of
 *     the new signature's /ByteRange and remain byte-perfect, so the previous
 *     signature(s) `/ByteRange` still cover the exact same bytes and stay
 *     verifiable.
 *   - Parse the prior xref (last `startxref` → table or stream) to learn:
 *       - prev xref offset → goes into the new trailer's `/Prev`
 *       - `/Size` (highest in-use object number + 1)
 *       - `/Root` reference (so the new trailer carries the Catalog ref)
 *       - locations of Catalog, AcroForm (if any), and first Page object
 *   - Build a tail (appended to file) that contains:
 *       1. New Sig dict object — includes `/ByteRange [0 ******** ******** ********]`
 *          plus `/Contents <000…>` placeholder (signatureLength bytes hex).
 *       2. New Widget annotation (refers to the new Sig).
 *       3. New AcroForm appearance stream (empty Form XObject for PDF/A).
 *       4. Updated Catalog (new generation, references existing or new
 *          AcroForm).
 *       5. Updated AcroForm (existing fields ‖ new widget ref) — same object
 *          number, bumped generation, with /SigFlags.
 *       6. Updated Page #0 (existing /Annots ‖ widget ref) — same object
 *          number, bumped generation.
 *       7. xref subsections covering the new + updated objects, with the
 *          "free" entries left untouched.
 *       8. Trailer with `/Size`, `/Prev <prevXref>`, `/Root <catalogRef>`.
 *       9. `startxref <newXrefOff>` + `%%EOF`.
 *   - Compute the real /ByteRange from the placeholdered tail position, write
 *     it into the placeholder slot, hash, build CMS, write hex /Contents.
 *
 * After this routine returns, calling `findSignature` (verifier) on the
 * output yields the LATEST signature; calling `detectSignatures` (this
 * package) yields all of them.
 *
 * --- Constraints ---
 *
 *   - Implementation does **NOT** rewrite any byte of the input. Slice 1 of
 *     the new signature is `[0, lengthOfInput)` — the previous signature's
 *     /ByteRange therefore still covers an unchanged byte sequence.
 *   - We require the input to be a non-encrypted, non-linearized PDF with a
 *     classic xref **table** (cross-ref streams are rejected with
 *     `cannot_add_signature_to_corrupt_pdf`). pdf-lib emits classic tables
 *     when `useObjectStreams: false`, which is what `signPdfPades` does.
 *   - First page is the host for the new widget annotation.
 *
 * @see plan F3 Task 10 / batch-4 Task 13.
 */

import { PDFDocument, PDFArray, PDFName, PDFRef, PDFDict, PDFNumber, PDFString } from 'pdf-lib';
import { SignerError } from './errors.js';
import { buildCmsSignedData } from './cms.js';
import { hashOf, importPrivateKey } from './webcrypto.js';
import { detectSignatures } from './detectExistingSignatures.js';
import type { ParsedPfx, SigAlg } from './types.js';
import type { PadesSignOptions } from './pades.js';

const SUBFILTER_ETSI_CADES_DETACHED = 'ETSI.CAdES.detached';
const DEFAULT_SIGNATURE_LENGTH = 32768;

type ParsedPfxFull = ParsedPfx & { privateKeyPkcs8Der: ArrayBuffer };

/**
 * Add a new PAdES-B-B signature to an already-signed PDF via incremental update.
 *
 * Output bytes start with `signedPdfBytes` byte-for-byte; new objects + xref
 * + trailer + %%EOF are appended after.
 */
export async function addIncrementalSignature(
  signedPdfBytes: Uint8Array,
  parsedPfx: ParsedPfxFull,
  opts: PadesSignOptions = {},
): Promise<Uint8Array> {
  // --- Quick sanity: input must be a PDF with at least one signature ---
  if (signedPdfBytes.length < 100 || signedPdfBytes[0] !== 0x25 /* % */) {
    throw new SignerError(
      'cannot_add_signature_to_corrupt_pdf',
      'Input does not start with PDF header',
    );
  }

  let prior;
  try {
    prior = await detectSignatures(signedPdfBytes);
  } catch (cause) {
    throw new SignerError(
      'cannot_add_signature_to_corrupt_pdf',
      `Failed to enumerate prior signatures: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    );
  }
  if (prior.length === 0) {
    throw new SignerError(
      'incremental_update_failed',
      'addIncrementalSignature called on a PDF with zero existing signatures — use signPdfPades instead',
    );
  }

  const sigAlg: SigAlg = opts.sigAlg ?? parsedPfx.sigAlg;
  const signatureLength = opts.signatureLength ?? DEFAULT_SIGNATURE_LENGTH;
  const signingTime = opts.signingTime ?? new Date();

  // --- Parse prior xref + structural refs we need to update ---
  let info: PriorPdfInfo;
  try {
    info = parsePriorPdf(signedPdfBytes);
  } catch (cause) {
    throw new SignerError(
      'cannot_add_signature_to_corrupt_pdf',
      `Failed to parse prior PDF structure: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    );
  }

  // --- Use pdf-lib only to render small dictionaries (Sig, Widget, AcroForm
  //     update, Catalog update, Page update) into well-formed PDF bytes. We
  //     do not call save(); we hand-serialize each object into the tail. ---
  let stub: PDFDocument;
  try {
    stub = await PDFDocument.load(signedPdfBytes, { updateMetadata: false });
  } catch (cause) {
    throw new SignerError(
      'cannot_add_signature_to_corrupt_pdf',
      `pdf-lib load failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    );
  }

  // We allocate fresh object numbers for the NEW objects (Sig, Widget,
  // FormXObject for /AP). Updates to existing objects (Catalog, AcroForm,
  // Page) reuse the same object number with generation bumped (we use
  // gen+1 — PDF spec doesn't strictly require it, but it's the conservative
  // value).
  let nextObjNum = info.size; // first free obj number
  const sigObjNum = nextObjNum++;
  const widgetObjNum = nextObjNum++;
  const apObjNum = nextObjNum++;
  let acroFormObjNum: number;
  let acroFormGenNum = 0;
  let acroFormPriorFields: string; // raw text fragment for /Fields entries from prior AcroForm
  let acroFormPriorSigFlags = 0;
  if (info.acroFormRef) {
    acroFormObjNum = info.acroFormRef.objectNumber;
    acroFormGenNum = info.acroFormRef.generationNumber;
    acroFormPriorFields = info.acroFormFieldsBody ?? '';
    acroFormPriorSigFlags = info.acroFormSigFlags ?? 0;
  } else {
    acroFormObjNum = nextObjNum++;
    acroFormPriorFields = '';
  }

  // --- Build dictionary text fragments ---
  const reason = opts.reason ?? 'Firma electronica';
  const location = opts.location ?? '';
  const contactInfo = opts.contactInfo ?? '';
  const name = parsedPfx.signingCert.subjectCN;

  // Signature object — placeholder /ByteRange + /Contents zeros.
  // We pad /ByteRange placeholders generously so real numbers fit.
  const byteRangePlaceholder = '[ 0 **********0 **********0 **********0 ]';
  const contentsPlaceholderHex = '0'.repeat(signatureLength * 2);
  const sigObjText =
    `${sigObjNum} 0 obj\n` +
    `<<\n` +
    `/Type /Sig\n` +
    `/Filter /Adobe.PPKLite\n` +
    `/SubFilter /${SUBFILTER_ETSI_CADES_DETACHED}\n` +
    `/ByteRange ${byteRangePlaceholder}\n` +
    `/Contents <${contentsPlaceholderHex}>\n` +
    `/Reason ${pdfStringLiteral(reason)}\n` +
    `/Location ${pdfStringLiteral(location)}\n` +
    `/ContactInfo ${pdfStringLiteral(contactInfo)}\n` +
    `/Name ${pdfStringLiteral(name)}\n` +
    `/M ${pdfDateLiteral(signingTime)}\n` +
    `>>\n` +
    `endobj\n`;

  // Form XObject for the widget /AP/N — minimal empty appearance stream.
  const apStreamBody = `q\nQ\n`;
  const apObjText =
    `${apObjNum} 0 obj\n` +
    `<< /Type /XObject /Subtype /Form /BBox [0 0 0 0] /Resources << >> /Length ${apStreamBody.length} >>\n` +
    `stream\n${apStreamBody}endstream\n` +
    `endobj\n`;

  // Widget annotation referencing the Sig (V) and the FormXObject (AP/N).
  //
  // 2026-05-15 (v0.7.17): scan ALL existing `/T (Signature<N>)` field names
  // in the input PDF and pick the first integer N that does NOT collide.
  // Previously we used `prior.length + 1`, which produced collisions on PDFs
  // whose existing fields jump indices (e.g. Adobe-produced PDFs label fields
  // `Signature`, `Signature3`, `Signature4`, `Signature5` — 4 sigs, counter
  // says 5, collides with the existing MARCO field. Result: PDF viewers
  // (incl. FirmaEC desktop) dedupe by name and drop one of the signatures.
  const inputText = new TextDecoder('latin1').decode(signedPdfBytes);
  const existingFieldNames = new Set<string>();
  for (const m of inputText.matchAll(/\/T\s*\(([^)]+)\)/g)) {
    existingFieldNames.add(m[1]!);
  }
  let candidateIdx = prior.length + 1;
  let fieldName = `Signature${candidateIdx}`;
  while (existingFieldNames.has(fieldName)) {
    candidateIdx += 1;
    fieldName = `Signature${candidateIdx}`;
  }
  const widgetObjText =
    `${widgetObjNum} 0 obj\n` +
    `<<\n` +
    `/Type /Annot\n` +
    `/Subtype /Widget\n` +
    `/FT /Sig\n` +
    `/Rect [0 0 0 0]\n` +
    `/V ${sigObjNum} 0 R\n` +
    `/T ${pdfStringLiteral(fieldName)}\n` +
    `/F 4\n` +
    `/P ${info.firstPageRef.objectNumber} ${info.firstPageRef.generationNumber} R\n` +
    `/AP << /N ${apObjNum} 0 R >>\n` +
    `>>\n` +
    `endobj\n`;

  // Updated AcroForm — append the new widget ref to /Fields and OR /SigFlags.
  // SigFlags = SignaturesExist (1) | AppendOnly (2) = 3.
  const newSigFlags = acroFormPriorSigFlags | 3;
  const acroFormFieldsBody =
    acroFormPriorFields.length > 0
      ? `${acroFormPriorFields} ${widgetObjNum} 0 R`
      : `${widgetObjNum} 0 R`;
  const acroFormObjText =
    `${acroFormObjNum} ${acroFormGenNum} obj\n` +
    `<< /Fields [${acroFormFieldsBody}] /SigFlags ${newSigFlags} >>\n` +
    `endobj\n`;

  // Updated Catalog — same object number/gen as the existing one, but with
  // /AcroForm pointing at our (possibly new) AcroForm ref.
  const catalogPagesEntry = info.catalogPagesEntry; // e.g., "2 0 R"
  const catalogObjText =
    `${info.catalogRef.objectNumber} ${info.catalogRef.generationNumber} obj\n` +
    `<< /Type /Catalog /Pages ${catalogPagesEntry} ` +
    `/AcroForm ${acroFormObjNum} ${acroFormGenNum} R >>\n` +
    `endobj\n`;

  // Updated first-page object — keep its existing dict body but rewrite
  // /Annots to include the new widget.
  const pageBody = injectAnnot(info.firstPageBody, widgetObjNum, 0);
  const pageObjText =
    `${info.firstPageRef.objectNumber} ${info.firstPageRef.generationNumber} obj\n` +
    `${pageBody}\n` +
    `endobj\n`;

  // --- Assemble the appended tail ---
  // We must align so that /Contents starts at a known offset; we measure
  // offsets as we concatenate.
  const enc = new TextEncoder();
  const inputLen = signedPdfBytes.length;

  // Some PDFs end without a trailing newline; ensure separation.
  const sep = signedPdfBytes[inputLen - 1] === 0x0a ? '' : '\n';

  // Body: Sig, AP, Widget, Catalog, AcroForm (if needed updated), Page.
  // Order doesn't matter for correctness as long as xref reflects offsets.
  const parts: Array<{ objNum: number; genNum: number; text: string }> = [];
  parts.push({ objNum: sigObjNum, genNum: 0, text: sigObjText });
  parts.push({ objNum: apObjNum, genNum: 0, text: apObjText });
  parts.push({ objNum: widgetObjNum, genNum: 0, text: widgetObjText });
  parts.push({
    objNum: info.catalogRef.objectNumber,
    genNum: info.catalogRef.generationNumber,
    text: catalogObjText,
  });
  parts.push({
    objNum: acroFormObjNum,
    genNum: acroFormGenNum,
    text: acroFormObjText,
  });
  parts.push({
    objNum: info.firstPageRef.objectNumber,
    genNum: info.firstPageRef.generationNumber,
    text: pageObjText,
  });

  // Concatenate body + record per-object byte offsets relative to file start.
  let cursor = inputLen + sep.length;
  const objectOffsets = new Map<number, { offset: number; gen: number }>();
  let bodyText = sep;
  for (const p of parts) {
    objectOffsets.set(p.objNum, { offset: cursor, gen: p.genNum });
    bodyText += p.text;
    cursor += enc.encode(p.text).length;
  }

  // xref. Cross-ref needs subsections. We'll emit a single subsection 0..size-1
  // marking unaffected entries as "n 0000000000 65535 f" — wait, that's
  // wrong: classical PDF xref only carries entries for objects we list.
  // Incremental updates use multiple subsections. We compute the minimal
  // subsection set: free obj 0 + each updated/new obj.
  const newSize = nextObjNum;
  const xrefOffset = cursor;
  const xrefText = buildXref(objectOffsets, newSize);

  const trailerText =
    `trailer\n` +
    `<< /Size ${newSize} ` +
    `/Root ${info.catalogRef.objectNumber} ${info.catalogRef.generationNumber} R ` +
    `/Prev ${info.prevXrefOffset} >>\n` +
    `startxref\n${xrefOffset}\n` +
    `%%EOF\n`;

  const tail = enc.encode(bodyText + xrefText + trailerText);
  const out = new Uint8Array(inputLen + tail.length);
  out.set(signedPdfBytes, 0);
  out.set(tail, inputLen);

  // --- Locate the placeholder /ByteRange + /Contents window in `out` and
  //     fill them in. We search ONLY past `inputLen` to avoid touching prior
  //     signatures' windows. ---
  const window = locateNewSigWindow(out, inputLen);

  // Real ByteRange covers everything except the /Contents hex bytes.
  const [, , , ] = [0, 0, 0, 0];
  const ltOffset = window.contentsHexStart - 1; // '<' position
  const gtOffset = window.contentsHexEnd; // '>' position
  const realByteRange: [number, number, number, number] = [
    0,
    ltOffset,
    gtOffset + 1,
    out.length - (gtOffset + 1),
  ];
  const brStr = `[ ${realByteRange[0]} ${realByteRange[1]} ${realByteRange[2]} ${realByteRange[3]} ]`;
  if (brStr.length > window.byteRangeSlotLen) {
    throw new SignerError(
      'incremental_update_failed',
      `ByteRange string (${brStr.length}) exceeds reserved slot (${window.byteRangeSlotLen})`,
    );
  }
  const padded = brStr.padEnd(window.byteRangeSlotLen, ' ');
  out.set(enc.encode(padded), window.byteRangeSlotStart);

  // --- Hash covered bytes + build CMS ---
  const [a, b, c, d] = realByteRange;
  const covered = new Uint8Array(b + d);
  covered.set(out.subarray(a, a + b), 0);
  covered.set(out.subarray(c, c + d), b);

  const hashAlg = hashOf(sigAlg);
  const messageDigest = new Uint8Array(
    await crypto.subtle.digest(
      hashAlg,
      covered.buffer.slice(
        covered.byteOffset,
        covered.byteOffset + covered.byteLength,
      ) as ArrayBuffer,
    ),
  );

  const privateKey = await importPrivateKey(parsedPfx.privateKeyPkcs8Der, sigAlg);
  let cmsDer: Uint8Array;
  try {
    // F6: keep timestamp opt-out by default for incremental updates — the
    // top-level `signPdfPades` is the documented entry point for B-T.
    const cmsRes = await buildCmsSignedData({
      messageDigest,
      signerCertDer: parsedPfx.signingCert.der,
      intermediateCertDers: parsedPfx.intermediates.map((cc) => cc.der),
      privateKey,
      sigAlg,
      signingTime,
      timestamp: false,
    });
    cmsDer = cmsRes.cms;
  } catch (cause) {
    throw new SignerError(
      'incremental_update_failed',
      `CMS build failed during incremental: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    );
  }

  const cmsHex = bytesToHex(cmsDer);
  const reservedHexLen = window.contentsHexEnd - window.contentsHexStart;
  if (cmsHex.length > reservedHexLen) {
    throw new SignerError(
      'signature_too_long',
      `CMS DER (${cmsDer.length} bytes) exceeds reserved /Contents window (${reservedHexLen / 2} bytes)`,
    );
  }
  const paddedHex = cmsHex.padEnd(reservedHexLen, '0');
  out.set(enc.encode(paddedHex), window.contentsHexStart);

  // Reference stub to keep the import alive (pdf-lib is required for the load
  // sanity check above). Mark intentionally unused.
  void stub;
  void PDFArray;
  void PDFName;
  void PDFRef;
  void PDFDict;
  void PDFNumber;
  void PDFString;

  return out;
}

// ---------- Helpers ----------

interface PriorPdfInfo {
  prevXrefOffset: number;
  size: number;
  catalogRef: { objectNumber: number; generationNumber: number };
  catalogPagesEntry: string;
  acroFormRef: { objectNumber: number; generationNumber: number } | null;
  acroFormFieldsBody: string | null;
  acroFormSigFlags: number | null;
  firstPageRef: { objectNumber: number; generationNumber: number };
  firstPageBody: string;
}

/**
 * Parse the xref-stream object dictionary at `objOffset` and return the
 * trailer-equivalent fields. We do NOT decompress the xref data portion —
 * the only thing the incremental update needs from the prior xref is /Size +
 * /Root (PDF 1.5+ lets us emit a classic xref + classic trailer chained via
 * /Prev to the start of the old xref stream object — "hybrid" docs are valid
 * per ISO 32000-1 §7.5.8.4).
 *
 * Expects a structure like:
 *   N M obj
 *   <<
 *     /Type /XRef
 *     /Size 123
 *     /Root 1 0 R
 *     /W [ 1 3 1 ]
 *     /Length 456
 *     /Filter /FlateDecode
 *     …
 *   >>
 *   stream
 *   [binary]
 *   endstream
 *   endobj
 *
 * Throws when the dict isn't a /Type /XRef stream (caller should fall back
 * to the classic-xref-table parser).
 */
function parseXrefStreamDict(text: string, objOffset: number): { size: number; rootObj: number; rootGen: number } {
  // Skip past `N M obj` token to the opening `<<`.
  const objStart = text.indexOf('<<', objOffset);
  if (objStart < 0 || objStart - objOffset > 64) {
    throw new Error(`xref-stream: '<<' not found near offset ${objOffset}`);
  }
  const dictEnd = text.indexOf('>>', objStart);
  if (dictEnd < 0) throw new Error('xref-stream: dictionary close >> not found');
  const dict = text.substring(objStart, dictEnd + 2);

  if (!/\/Type\s*\/XRef\b/.test(dict)) {
    throw new Error(
      `cross-reference at offset ${objOffset} is neither a classical xref table nor a /Type /XRef stream`,
    );
  }

  const sizeMatch = dict.match(/\/Size\s+(\d+)/);
  if (!sizeMatch) throw new Error('/Size missing in xref-stream dictionary');
  const rootMatch = dict.match(/\/Root\s+(\d+)\s+(\d+)\s+R/);
  if (!rootMatch) throw new Error('/Root missing in xref-stream dictionary');
  return {
    size: parseInt(sizeMatch[1]!, 10),
    rootObj: parseInt(rootMatch[1]!, 10),
    rootGen: parseInt(rootMatch[2]!, 10),
  };
}

function parsePriorPdf(pdf: Uint8Array): PriorPdfInfo {
  const text = new TextDecoder('latin1').decode(pdf);

  // Find the LAST `startxref` followed by digits.
  const startxrefMatches = [...text.matchAll(/startxref\s+(\d+)/g)];
  if (startxrefMatches.length === 0) throw new Error('startxref not found');
  const lastSx = startxrefMatches[startxrefMatches.length - 1]!;
  const prevXrefOffset = parseInt(lastSx[1]!, 10);

  // Detect classical xref table vs xref stream (PDF 1.5+). Classical tables
  // start with the ASCII keyword `xref`; xref streams are objects (`N M obj`
  // followed by a `<<...>>` dict with `/Type /XRef`).
  let size: number;
  let catalogRef: { objectNumber: number; generationNumber: number };

  if (text.substring(prevXrefOffset, prevXrefOffset + 4) === 'xref') {
    // Classic xref table path.
    const trailerIdx = text.indexOf('trailer', prevXrefOffset);
    if (trailerIdx < 0) throw new Error('trailer not found after xref');
    const trailerEnd = text.indexOf('startxref', trailerIdx);
    if (trailerEnd < 0) throw new Error('trailer end (startxref) not found');
    const trailerBlock = text.substring(trailerIdx, trailerEnd);

    const sizeMatch = trailerBlock.match(/\/Size\s+(\d+)/);
    if (!sizeMatch) throw new Error('/Size missing in trailer');
    size = parseInt(sizeMatch[1]!, 10);

    const rootMatch = trailerBlock.match(/\/Root\s+(\d+)\s+(\d+)\s+R/);
    if (!rootMatch) throw new Error('/Root missing in trailer');
    catalogRef = {
      objectNumber: parseInt(rootMatch[1]!, 10),
      generationNumber: parseInt(rootMatch[2]!, 10),
    };
  } else {
    // Xref-stream path (typical for PDF 1.5+ documents, including SRI
    // comprobantes). We append our classic xref+trailer with /Prev pointing
    // at the start of the prior xref-stream object — PDF spec §7.5.8.4
    // permits this "hybrid" update.
    const parsed = parseXrefStreamDict(text, prevXrefOffset);
    size = parsed.size;
    catalogRef = { objectNumber: parsed.rootObj, generationNumber: parsed.rootGen };
  }

  // Read the Catalog object body.
  const catalogBody = readObjectBody(text, catalogRef.objectNumber, catalogRef.generationNumber);
  if (!catalogBody) throw new Error('Catalog object body not found');

  // Extract /Pages reference from Catalog.
  const pagesMatch = catalogBody.match(/\/Pages\s+(\d+)\s+(\d+)\s+R/);
  if (!pagesMatch) throw new Error('/Pages missing in Catalog');
  const catalogPagesEntry = `${pagesMatch[1]} ${pagesMatch[2]} R`;
  const pagesObjNum = parseInt(pagesMatch[1]!, 10);
  const pagesGenNum = parseInt(pagesMatch[2]!, 10);

  // Extract optional /AcroForm ref.
  const acroFormMatch = catalogBody.match(/\/AcroForm\s+(\d+)\s+(\d+)\s+R/);
  let acroFormRef: PriorPdfInfo['acroFormRef'] = null;
  let acroFormFieldsBody: string | null = null;
  let acroFormSigFlags: number | null = null;
  if (acroFormMatch) {
    acroFormRef = {
      objectNumber: parseInt(acroFormMatch[1]!, 10),
      generationNumber: parseInt(acroFormMatch[2]!, 10),
    };
    const afBody = readObjectBody(text, acroFormRef.objectNumber, acroFormRef.generationNumber);
    if (afBody) {
      // Extract existing /Fields entries (refs only, comma- or whitespace-separated).
      const fieldsArrMatch = afBody.match(/\/Fields\s*\[([^\]]*)\]/);
      if (fieldsArrMatch) {
        acroFormFieldsBody = fieldsArrMatch[1]!.trim();
      } else {
        acroFormFieldsBody = '';
      }
      const sfMatch = afBody.match(/\/SigFlags\s+(\d+)/);
      acroFormSigFlags = sfMatch ? parseInt(sfMatch[1]!, 10) : 0;
    }
  }

  // Resolve the FIRST page from the /Pages dict's /Kids array.
  const pagesBody = readObjectBody(text, pagesObjNum, pagesGenNum);
  if (!pagesBody) throw new Error('Pages object body not found');
  const kidsMatch = pagesBody.match(/\/Kids\s*\[([^\]]*)\]/);
  if (!kidsMatch) throw new Error('/Kids missing in Pages');
  const firstKidMatch = kidsMatch[1]!.match(/(\d+)\s+(\d+)\s+R/);
  if (!firstKidMatch) throw new Error('No first kid in /Kids');
  const firstPageRef = {
    objectNumber: parseInt(firstKidMatch[1]!, 10),
    generationNumber: parseInt(firstKidMatch[2]!, 10),
  };
  const firstPageBody = readObjectBody(text, firstPageRef.objectNumber, firstPageRef.generationNumber);
  if (!firstPageBody) throw new Error('First page object body not found');

  return {
    prevXrefOffset,
    size,
    catalogRef,
    catalogPagesEntry,
    acroFormRef,
    acroFormFieldsBody,
    acroFormSigFlags,
    firstPageRef,
    firstPageBody,
  };
}

/**
 * Read an indirect object body (between `<< ... >>` or stream) given its
 * object/generation numbers. Returns the body text including the surrounding
 * dictionary `<< ... >>` (without the `objNum genNum obj\n ... endobj`
 * envelope). Returns null if not found.
 *
 * IMPORTANT: when multiple revisions exist (incremental updates), we want the
 * LATEST in-use object. We read the LAST occurrence in file order.
 */
function readObjectBody(text: string, objNum: number, genNum: number): string | null {
  const re = new RegExp(`\\b${objNum}\\s+${genNum}\\s+obj\\b`, 'g');
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) return null;
  // Pick the last one (latest revision in classical PDFs).
  const last = matches[matches.length - 1]!;
  const startBody = last.index! + last[0].length;
  const endIdx = text.indexOf('endobj', startBody);
  if (endIdx < 0) return null;
  return text.substring(startBody, endIdx).trim();
}

/**
 * Inject `widgetRef` into a page object's `/Annots` array. If `/Annots` is
 * absent, add it as a new entry. If `/Annots` is an indirect ref, we replace
 * it with a literal array containing the original ref + the new widget ref —
 * this works because the PDF parser dereferences indirects, but introduces a
 * tiny correctness wrinkle for downstream consumers: we accept the trade-off
 * (Adobe Reader handles this fine).
 */
function injectAnnot(pageBody: string, widgetObjNum: number, widgetGenNum: number): string {
  const newRef = `${widgetObjNum} ${widgetGenNum} R`;
  const annotsLiteralMatch = pageBody.match(/\/Annots\s*\[([^\]]*)\]/);
  if (annotsLiteralMatch) {
    const inner = annotsLiteralMatch[1]!.trim();
    const replacement = `/Annots [${inner.length > 0 ? inner + ' ' : ''}${newRef}]`;
    return pageBody.replace(annotsLiteralMatch[0], replacement);
  }
  const annotsIndirectMatch = pageBody.match(/\/Annots\s+(\d+)\s+(\d+)\s+R/);
  if (annotsIndirectMatch) {
    const replacement = `/Annots [${annotsIndirectMatch[1]} ${annotsIndirectMatch[2]} R ${newRef}]`;
    return pageBody.replace(annotsIndirectMatch[0], replacement);
  }
  // No /Annots — splice into the dict before the closing `>>`.
  const dictClose = pageBody.lastIndexOf('>>');
  if (dictClose < 0) {
    // Wrap as a dict (defensive; shouldn't happen for valid pages).
    return `<< ${pageBody} /Annots [${newRef}] >>`;
  }
  return pageBody.substring(0, dictClose) + ` /Annots [${newRef}] ` + pageBody.substring(dictClose);
}

/**
 * Build a classical xref table for the given object offsets. We emit obj 0
 * + one subsection per contiguous run of touched objects.
 */
function buildXref(
  offsets: Map<number, { offset: number; gen: number }>,
  size: number,
): string {
  // Always include the free obj 0 sentinel (single-object subsection).
  // Then emit subsections for the touched objects.
  const touched = [...offsets.entries()].sort((a, b) => a[0] - b[0]);
  let out = `xref\n`;
  out += `0 1\n`;
  out += `0000000000 65535 f \n`;
  // Group consecutive obj numbers into subsections.
  let i = 0;
  while (i < touched.length) {
    const startObj = touched[i]![0];
    let j = i;
    while (
      j + 1 < touched.length &&
      touched[j + 1]![0] === touched[j]![0] + 1
    ) {
      j++;
    }
    const count = j - i + 1;
    out += `${startObj} ${count}\n`;
    for (let k = i; k <= j; k++) {
      const [, info] = touched[k]!;
      out += `${info.offset.toString().padStart(10, '0')} ${info.gen
        .toString()
        .padStart(5, '0')} n \n`;
    }
    i = j + 1;
  }
  void size;
  return out;
}

interface NewSigWindow {
  byteRangeSlotStart: number;
  byteRangeSlotLen: number;
  contentsHexStart: number;
  contentsHexEnd: number;
}

/** Locate the placeholder /ByteRange + /Contents in the freshly-appended tail. */
function locateNewSigWindow(out: Uint8Array, searchFrom: number): NewSigWindow {
  const text = new TextDecoder('latin1').decode(out);
  // Find the placeholder ByteRange (literal asterisks).
  const brIdx = text.indexOf('/ByteRange [ 0 **********0', searchFrom);
  if (brIdx < 0) throw new SignerError('incremental_update_failed', 'New /ByteRange placeholder not found');
  const openBr = text.indexOf('[', brIdx);
  const closeBr = text.indexOf(']', openBr);
  if (openBr < 0 || closeBr < 0)
    throw new SignerError('incremental_update_failed', 'New /ByteRange brackets not found');

  // Locate /Contents <...>
  const ctIdx = text.indexOf('/Contents', closeBr);
  if (ctIdx < 0) throw new SignerError('incremental_update_failed', 'New /Contents not found');
  let i = ctIdx + '/Contents'.length;
  while (i < out.length) {
    const b = out[i]!;
    if (b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) break;
    i++;
  }
  if (out[i] !== 0x3c)
    throw new SignerError('incremental_update_failed', `Expected '<' at /Contents start`);
  const ltOffset = i;
  let j = i + 1;
  while (j < out.length && out[j] !== 0x3e) j++;
  if (j >= out.length)
    throw new SignerError('incremental_update_failed', 'New /Contents > not found');
  const gtOffset = j;

  return {
    byteRangeSlotStart: openBr,
    byteRangeSlotLen: closeBr - openBr + 1,
    contentsHexStart: ltOffset + 1,
    contentsHexEnd: gtOffset,
  };
}

function pdfStringLiteral(s: string): string {
  // PDF literal string with paren-escaping for ( ) \.
  const escaped = s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  return `(${escaped})`;
}

function pdfDateLiteral(d: Date): string {
  const pad = (n: number, w = 2): string => n.toString().padStart(w, '0');
  const y = d.getUTCFullYear();
  const mo = pad(d.getUTCMonth() + 1);
  const da = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `(D:${y}${mo}${da}${hh}${mm}${ss}Z)`;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}
