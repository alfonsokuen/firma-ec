/**
 * Visible signature widget builder for @firma-ec/signer.
 *
 * Sprint C Batch 5 — F3 Tasks 17-19.
 *
 * Design (per UI Pro Max adendum 2026-05-09):
 *   - Single template: only "Firmado por: <CN>" (no date / reason / location
 *     in the visible box — those still land in the /Sig dict for Reader).
 *   - No border (MVP).
 *   - Helvetica (PDF standard font, embedded as a resource named /Helv).
 *   - Default 200×60 pt, but user-controllable via x/y/width/height.
 *   - 6pt internal padding, black text, transparent background.
 *
 * The actual widget annotation + Sig dict are created by
 * `@signpdf/placeholder-pdf-lib`'s `pdflibAddPlaceholder`, which produces an
 * empty Form XObject as the widget Appearance Stream. Our job here:
 *
 *   1. **Validate** the requested rect against the target page bounds and
 *      minimum dimensions.
 *   2. **Embed** Helvetica via `pdfDoc.embedFont(StandardFonts.Helvetica)` so
 *      we have a reusable font ref.
 *   3. After the placeholder is inserted, **locate** the Widget annotation
 *      added to the target page (it's the last `/Subtype /Widget` annot on
 *      the page) and **rewrite** its `AP/N` Form XObject:
 *        - set BBox to the rect's local-space [0, 0, w, h],
 *        - attach `Resources << /Font << /Helv <fontRef> >> >>`,
 *        - replace the empty operator list with the "Firmado por: …" draw.
 *
 * The widget remains linked to the Sig dict via `/V`, so signing semantics
 * are unchanged — we only paint the appearance.
 *
 * @see docs/superpowers/specs/2026-05-09-firma-ec-F3-firma-MVP-design.md §4.4
 */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFContentStream,
  PDFOperator,
  StandardFonts,
  beginText,
  endText,
  moveText,
  setFontAndSize,
  setFillingRgbColor,
  showText,
  pushGraphicsState,
  popGraphicsState,
  PDFHexString,
} from 'pdf-lib';
import { SignerError } from './errors.js';

/** Public input for a visible signature placement (Batch 5 contract). */
export interface VisibleSigInput {
  /** 0-based page index. */
  page: number;
  /** Lower-left X in PDF user-space (origin bottom-left). */
  x: number;
  /** Lower-left Y in PDF user-space. */
  y: number;
  /** Box width in pt. */
  width: number;
  /** Box height in pt. */
  height: number;
  /** Signer common name to render — typically `parsedPfx.signingCert.subjectCN`. */
  signerCN: string;
}

/** Default rectangle suggested by UX pass when user hasn't placed it yet. */
export const DEFAULT_VISIBLE_SIG_WIDTH = 200;
export const DEFAULT_VISIBLE_SIG_HEIGHT = 60;

/** Minimum legible box (smaller than this and Helv 10pt with 6pt padding clips). */
export const MIN_VISIBLE_SIG_WIDTH = 30;
export const MIN_VISIBLE_SIG_HEIGHT = 30;

/** Internal padding (pt) inside the widget box. */
const PADDING_PT = 6;

/** Helvetica font size (pt). */
const FONT_SIZE_PT = 10;

/** Maximum CN characters before truncation with ellipsis. */
const MAX_CN_CHARS = 50;
const ELLIPSIS = '…'; // single-char ellipsis (WinAnsi 0x85, valid in Helvetica)

/** "Firmado por: " label prefix. */
const LABEL = 'Firmado por: ';

/**
 * Validate that a {@link VisibleSigInput} fits in the target page and meets
 * minimum legibility constraints.
 *
 * Throws {@link SignerError} with one of:
 *   - `visible_sig_invalid_page` — page index < 0 or ≥ pageCount.
 *   - `visible_sig_too_small`    — width < 30 or height < 30.
 *   - `visible_sig_out_of_bounds` — rect extends outside page MediaBox.
 */
export function validateVisibleSig(pdfDoc: PDFDocument, spec: VisibleSigInput): void {
  const pages = pdfDoc.getPages();
  if (!Number.isInteger(spec.page) || spec.page < 0 || spec.page >= pages.length) {
    throw new SignerError(
      'visible_sig_invalid_page',
      `Visible signature page index ${spec.page} out of range [0..${pages.length - 1}]`,
    );
  }
  if (spec.width < MIN_VISIBLE_SIG_WIDTH || spec.height < MIN_VISIBLE_SIG_HEIGHT) {
    throw new SignerError(
      'visible_sig_too_small',
      `Visible signature box ${spec.width}×${spec.height} pt below minimum ${MIN_VISIBLE_SIG_WIDTH}×${MIN_VISIBLE_SIG_HEIGHT}`,
    );
  }
  const page = pages[spec.page]!;
  const { width: pageW, height: pageH } = page.getSize();
  if (
    spec.x < 0 ||
    spec.y < 0 ||
    spec.x + spec.width > pageW ||
    spec.y + spec.height > pageH
  ) {
    throw new SignerError(
      'visible_sig_out_of_bounds',
      `Visible signature rect [${spec.x},${spec.y} ${spec.width}×${spec.height}] does not fit page ${spec.page} (${pageW}×${pageH})`,
    );
  }
}

/** Truncate a CN to at most {@link MAX_CN_CHARS} including ellipsis. */
export function truncateCN(cn: string, maxChars: number = MAX_CN_CHARS): string {
  if (cn.length <= maxChars) return cn;
  return cn.slice(0, maxChars - 1) + ELLIPSIS;
}

/**
 * Build the operator list that draws "Firmado por: <CN>" inside a box of the
 * given dimensions. The widget's BBox is `[0, 0, width, height]`, so all
 * coordinates are local.
 */
export function buildAppearanceOperators(
  width: number,
  height: number,
  signerCN: string,
): PDFOperator[] {
  void width; // width not used yet; reserved for centering/right-align variants.
  const text = LABEL + truncateCN(signerCN);

  // Single line baseline at top of the box minus padding minus font ascent.
  // Helvetica ascent ≈ 0.718 of em; for size 10 ≈ 7.18 pt. We use a simple
  // heuristic: place baseline at `height - PADDING - FONT_SIZE * 0.8`.
  const baselineY = Math.max(PADDING_PT, height - PADDING_PT - FONT_SIZE_PT * 0.8);

  // Encode text as a PDF hex string of the WinAnsi (latin1) bytes — Helvetica
  // is a Type 1 standard font with WinAnsiEncoding default, so each char maps
  // 1:1 to its byte. We avoid PDFHexString.fromText (which emits UTF-16BE with
  // BOM and would render as garbage with WinAnsi).
  let hex = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) & 0xff;
    hex += code.toString(16).padStart(2, '0');
  }
  return [
    pushGraphicsState(),
    setFillingRgbColor(0, 0, 0),
    beginText(),
    setFontAndSize('Helv', FONT_SIZE_PT),
    moveText(PADDING_PT, baselineY),
    showText(PDFHexString.of(hex)),
    endText(),
    popGraphicsState(),
  ];
}

/**
 * Find the Widget annotation that `pdflibAddPlaceholder` just appended to the
 * given page. It's the last Annot whose `/Subtype` is `Widget` AND whose
 * `/FT` is `Sig` (we ignore non-signature widgets like form fields).
 */
function findLastSigWidget(pdfDoc: PDFDocument, pageIndex: number): PDFDict {
  const page = pdfDoc.getPages()[pageIndex];
  if (!page) {
    throw new SignerError(
      'visible_sig_invalid_page',
      `Page ${pageIndex} not found while linking widget`,
    );
  }
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) {
    throw new SignerError(
      'cms_build_failed',
      `Page ${pageIndex} has no /Annots after pdflibAddPlaceholder — placeholder did not register the widget`,
    );
  }
  // Walk backwards to grab the most recently appended sig widget.
  for (let i = annots.size() - 1; i >= 0; i--) {
    const item = annots.lookup(i);
    if (!(item instanceof PDFDict)) continue;
    const subtype = item.lookupMaybe(PDFName.of('Subtype'), PDFName);
    const ft = item.lookupMaybe(PDFName.of('FT'), PDFName);
    if (
      subtype &&
      ft &&
      // PDFName toString returns "/Widget" / "/Sig"
      subtype.toString() === '/Widget' &&
      ft.toString() === '/Sig'
    ) {
      return item;
    }
  }
  throw new SignerError(
    'cms_build_failed',
    `No /Subtype /Widget /FT /Sig annotation found on page ${pageIndex}`,
  );
}

/**
 * Replace the empty Appearance Stream that `pdflibAddPlaceholder` produced
 * with a real one rendering "Firmado por: <CN>".
 *
 * This function:
 *   1. Looks up the most recently added sig Widget annotation on `spec.page`.
 *   2. Rewrites its /Rect to the new rectangle (in case caller passed a
 *      different rect than the widgetRect plumbed through pdflibAddPlaceholder).
 *   3. Locates the AP/N Form XObject and:
 *        - sets BBox = [0, 0, width, height],
 *        - attaches `Resources << /Font << /Helv <helvFontRef> >> >>`,
 *        - replaces operators with {@link buildAppearanceOperators}.
 *
 * @returns The widget annotation dict (for caller introspection / tests).
 */
export function attachVisibleSignatureAppearance(
  pdfDoc: PDFDocument,
  spec: VisibleSigInput,
  helvFontRef: PDFRef,
): { widget: PDFDict; appearanceStream: PDFContentStream } {
  const widget = findLastSigWidget(pdfDoc, spec.page);

  // Rewrite /Rect to match the spec exactly (lower-left x,y → upper-right).
  const ctx = pdfDoc.context;
  const x1 = spec.x;
  const y1 = spec.y;
  const x2 = spec.x + spec.width;
  const y2 = spec.y + spec.height;
  widget.set(PDFName.of('Rect'), ctx.obj([x1, y1, x2, y2]));

  // Look up AP /N
  const ap = widget.lookupMaybe(PDFName.of('AP'), PDFDict);
  if (!ap) {
    throw new SignerError(
      'cms_build_failed',
      `Widget annotation missing /AP dict — pdflibAddPlaceholder contract changed`,
    );
  }
  const nRef = ap.get(PDFName.of('N'));
  if (!(nRef instanceof PDFRef)) {
    throw new SignerError(
      'cms_build_failed',
      `Widget /AP/N is not an indirect reference — got ${nRef?.constructor.name ?? 'undefined'}`,
    );
  }
  const apStream = ctx.lookup(nRef);
  if (!(apStream instanceof PDFContentStream)) {
    throw new SignerError(
      'cms_build_failed',
      `Widget /AP/N target is not a PDFContentStream — got ${apStream?.constructor.name ?? 'undefined'}`,
    );
  }

  // Update the XObject dict: BBox + Resources + Subtype/Type guarantees.
  const apDict = apStream.dict;
  apDict.set(PDFName.of('Type'), PDFName.of('XObject'));
  apDict.set(PDFName.of('Subtype'), PDFName.of('Form'));
  apDict.set(PDFName.of('BBox'), ctx.obj([0, 0, spec.width, spec.height]));
  apDict.set(PDFName.of('Matrix'), ctx.obj([1, 0, 0, 1, 0, 0]));
  apDict.set(
    PDFName.of('Resources'),
    ctx.obj({
      Font: { Helv: helvFontRef },
    }),
  );

  // Replace operators in-place.
  const ops = buildAppearanceOperators(spec.width, spec.height, spec.signerCN);
  // PDFContentStream.operators is a public mutable array — see core/structures/PDFContentStream.js.
  (apStream as unknown as { operators: PDFOperator[] }).operators = ops;

  // Note: we don't override /T (field name); pdflibAddPlaceholder sets it to
  // 'Signature1' and the @signpdf incremental path expects that.

  return { widget, appearanceStream: apStream };
}

/**
 * Convenience: embed Helvetica (a standard PDF font) into `pdfDoc` and return
 * its indirect reference for use in widget /Resources.
 *
 * Helvetica is one of the 14 PDF Type 1 standard fonts — viewers ship it,
 * so embedding adds only a font dictionary, not the font program.
 */
export async function embedHelvetica(pdfDoc: PDFDocument): Promise<PDFRef> {
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  return font.ref;
}

/** Low-level export for tests / advanced callers. */
export const __internals = {
  truncateCN,
  buildAppearanceOperators,
  findLastSigWidget,
  PADDING_PT,
  FONT_SIZE_PT,
  MAX_CN_CHARS,
  LABEL,
};
