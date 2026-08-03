/**
 * noFreeSlotPdf.ts — builds a single-page, legal PDF whose text covers the
 * page margin-to-margin, so the auto-placement engine cannot find ANY spot
 * for the signature box and the document comes out of the pre-flight as
 * `needs_review` / `no_free_slot`.
 *
 * Generated fresh at test-run time, same convention as
 * `tests/e2e/helpers/heavy-preflight-pdf.ts` (F0). Nothing about its content
 * is sensitive — it's redundant filler text. It lives under `src/` (not
 * `tests/e2e/helpers/`, where `heavy-preflight-pdf.ts` lives) because it is
 * shared by a fast unit test (`noFreeSlotPdf.test.ts`, next to this file)
 * AND the e2e spec (`tests/e2e/firmar-lote-colocador-manual.spec.ts`) — and
 * `src/`'s `tsconfig.json` pins `rootDir: "src"`, so a source file under
 * `src/` cannot import from `tests/e2e/` without breaking the build. The e2e
 * spec importing INTO `src/` has no such restriction (it isn't part of that
 * tsconfig's `include`).
 *
 * ## Why this actually forces `no_free_slot`
 *
 * `computeAutoPlacement` (`packages/signer/src/autoPlacement.ts`) enumerates
 * vertical slots for the default 240×72pt box using `enumerateSlots`, which
 * treats every text band as an obstacle spanning the FULL visible page width
 * (`textBandRects` — a band never leaves room on the sides, only above/below
 * matters). A slot only exists where there's a vertical gap of at least
 * `boxH + GAP` (~86pt) between obstacles, within `EDGE_MARGIN` (18pt) of the
 * page edges.
 *
 * This fixture draws a text line every 8pt from near the top to near the
 * bottom of a US-Letter page (612×792pt). Lines this close together merge
 * into one continuous text band (`MERGE_TOLERANCE_PT = 2` in
 * `packages/signer/src/textBands.ts`), leaving no vertical gap anywhere close
 * to 86pt — not even at the very top or bottom margin. With no existing
 * signatures and no empty `/FT /Sig` field, the engine falls through
 * empty-field → anti-overlap (not applicable, nothing to avoid) →
 * free-space (this is where it fails) → `needs_review` with
 * `reason: 'no_free_slot'`.
 *
 * A companion unit test (`noFreeSlotPdf.test.ts`) asserts this fixture
 * actually produces `needs_review` against the REAL pipeline before the e2e
 * spec relies on it — so a future tuning change to the placement algorithm
 * that quietly stops rejecting this shape fails loudly in a fast unit test,
 * not as a flaky, slow e2e run.
 */
import { PDFDocument, PDFName } from 'pdf-lib';

const PAGE_W = 612;
const PAGE_H = 792;
/** Line pitch (pt) — small enough that consecutive lines merge into one
 *  continuous band (`MERGE_TOLERANCE_PT` in textBands.ts is 2pt). */
const LINE_PITCH_PT = 8;
/** Keep a hair inside the page edges; the density, not the margin, is what
 *  denies a slot — `EDGE_MARGIN` (18pt) plus a full box (72pt) is nowhere
 *  close to this line pitch. */
const TOP_MARGIN_PT = 12;
const BOTTOM_MARGIN_PT = 12;

/**
 * Builds one legal, single-page PDF with text packed margin-to-margin —
 * dense enough that no 72pt-tall gap exists anywhere for the default
 * signature box, without needing thousands of pages or huge content streams.
 */
export async function buildNoFreeSlotPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);

  const lines: string[] = [];
  for (let y = BOTTOM_MARGIN_PT; y <= PAGE_H - TOP_MARGIN_PT; y += LINE_PITCH_PT) {
    lines.push(
      `BT /F1 7 Tf 1 0 0 1 40 ${y} Tm (clausula de relleno sin espacio para la estampa) Tj ET`,
    );
  }
  const content = lines.join('\n');
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(content)));

  return doc.save();
}
