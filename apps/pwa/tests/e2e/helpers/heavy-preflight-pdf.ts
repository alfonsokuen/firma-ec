/**
 * heavy-preflight-pdf.ts — builds an "adversarial but legal" PDF on the fly
 * for `firmar-lote-responsividad.spec.ts`.
 *
 * Not a committed binary fixture: it is generated fresh at test-run time
 * (same convention as `global-setup.ts`'s ephemeral `.p12`) and written to the
 * OS temp dir, never under `tests/e2e/fixtures/`. Nothing about its content is
 * sensitive — it's redundant filler text — but there is no reason to grow the
 * repo with a binary that exists only to make a single test slow to analyze.
 *
 * ## Why MANY pages, not FAT pages
 *
 * The regression this test guards against was measured on a real document:
 * ~1,600 pages / 37 MB, ~16.6s of blocked main thread. The naive way to
 * reproduce "slow to analyze" is a FEW pages with huge content streams — but
 * `readTextBands` (packages/signer/src/textBands.ts) bounds each page's
 * content-stream work independently: `MAX_CONTENT_BYTES_PER_PAGE` (8 MiB) and
 * `MAX_OPERATORS_PER_PAGE` (200k tokens), guardrails added specifically so a
 * hostile PDF can't blow memory or spin forever on ONE page. Measured while
 * tuning this fixture: a page sitting right at the byte cap costs only
 * ~35-40ms to tokenize — nowhere near enough to clear a 200ms threshold
 * within the batch UI's own 40 MB per-file ceiling
 * (`MAX_BATCH_FILE_SIZE_BYTES`, apps/pwa/src/lib/workers/sign-queue.ts): five
 * pages at the byte cap is already ~38 MB and only ~180ms of work.
 *
 * What the caps do NOT bound is the FIXED per-page overhead outside content
 * tokenizing — walking `pdfDoc.getPages()`, resolving each page's geometry,
 * etc. — which is exactly what dominated the original 1,600-page document.
 * Reproducing that shape (many pages, each individually cheap) costs almost
 * nothing in file size, and — measured empirically against the ACTUAL
 * browser engine this suite runs in (Playwright's bundled Chromium, not
 * Node: V8 JIT behavior differs enough between the two that a Node-only
 * benchmark was not a reliable predictor here) — reliably produces a
 * synchronous main-thread block over the 200ms longtask threshold this test
 * asserts against, while staying comfortably inside the batch UI's 40 MB
 * per-file limit (`MAX_BATCH_FILE_SIZE_BYTES`,
 * apps/pwa/src/lib/workers/sign-queue.ts) — this file is well under 1 MB.
 * Confirmed RED against the pre-F0 commit (`4ce07a4`, no worker): two
 * longtasks per run, worst observed 298-314ms across repeated runs. Confirmed
 * GREEN against F0 HEAD (worker-based): 0 longtasks, worst RAF gap ~35ms,
 * for the exact same fixture and ~6s of total analysis wall time.
 */
import { PDFDocument, PDFName } from 'pdf-lib';

/** Content tuning — see module doc-comment for why these values. */
const PAGE_COUNT = 22_000;
const LINES_PER_PAGE = 6;

/**
 * Builds one legal, small PDF with far more pages than any real document
 * would need — the count, not the per-page content, is what makes analysis
 * slow. Each page carries a handful of ordinary text-draw operators, nothing
 * adversarial about the content stream itself.
 */
export async function buildHeavyPreflightPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  for (let p = 0; p < PAGE_COUNT; p++) {
    const page = doc.addPage([612, 792]);
    const lines: string[] = [];
    for (let i = 0; i < LINES_PER_PAGE; i++) {
      const y = 100 + (i % 5) * 10;
      lines.push(`BT /F1 8 Tf 1 0 0 1 72 ${y} Tm (linea ${i} de la pagina ${p}) Tj ET`);
    }
    const content = lines.join('\n');
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(content)));
  }

  return doc.save();
}
