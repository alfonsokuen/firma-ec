/**
 * lote-fixtures.ts — builds the minimal, deterministic PDF fixtures for the
 * batch-signing E2E (`lote-e2e.spec.ts`).
 *
 * Why hand-built instead of a library: the E2E needs pages whose `/Rotate`
 * and `/CropBox` are EXACTLY what the test says they are (they are the two
 * historical defects — D1/D2 — where the visible seal ended up outside the
 * displayed area). Writing the ~6 objects by hand keeps the fixture free of
 * library defaults (pdf-lib normalises boxes, adds producer metadata and
 * dates) and byte-for-byte deterministic: same input → same bytes, no clock,
 * no randomness — which criterion 8 (repeatable) requires.
 *
 * The output is a valid single-page PDF 1.7 with a real xref table, loadable
 * by pdf-lib (what `@firma-ec/signer` uses) and by pdf.js (what the
 * independent verification uses).
 */

/** US-Letter page size in PDF points — the size the PWA sees most often. */
export const LETTER_W_PT = 612;
export const LETTER_H_PT = 792;

/**
 * CropBox for the "crop" fixture: a 360×360 pt window strictly inside the
 * MediaBox. Chosen so that a naïve MediaBox-footer placement (y ≈ 18 pt, the
 * pre-`computeAutoPlacement` behaviour) falls BELOW `cropY0` = 300 — i.e. the
 * fixture discriminates: the old bug lands the seal outside the visible area,
 * the fixed placement lands it inside. 360 pt of visible width also leaves
 * room for the default 240 pt seal + 2×18 pt margins (276 pt), so the auto
 * placement has a valid slot.
 */
export const CROP_X0 = 100;
export const CROP_Y0 = 300;
export const CROP_X1 = 460;
export const CROP_Y1 = 660;

export interface MinimalPdfOptions {
  /** Marker text drawn on the page — lets the spec assert output↔input order. */
  marker: string;
  /** `/Rotate` for the page (0/90/180/270). Omit for none. */
  rotate?: 0 | 90 | 180 | 270;
  /** `/CropBox` [x0 y0 x1 y1]. Omit for none (CropBox defaults to MediaBox). */
  cropBox?: [number, number, number, number];
}

/**
 * Build a minimal single-page PDF with a text marker and optional
 * `/Rotate` / `/CropBox`. Pure function of its options.
 */
export function buildMinimalPdf(opts: MinimalPdfOptions): Uint8Array {
  const contentStream = [
    'BT',
    '/F1 24 Tf',
    // Text placed mid-page so it never collides with the seal footer band.
    `72 ${LETTER_H_PT / 2} Td`,
    `(${escapePdfString(opts.marker)}) Tj`,
    'ET',
  ].join('\n');

  const pageExtras = [
    opts.rotate !== undefined && opts.rotate !== 0 ? `/Rotate ${opts.rotate}` : '',
    opts.cropBox ? `/CropBox [${opts.cropBox.join(' ')}]` : '',
  ]
    .filter((s) => s.length > 0)
    .join(' ');

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LETTER_W_PT} ${LETTER_H_PT}] ${pageExtras} ` +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`,
  ];

  let body = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  const full = body + xref + trailer;
  // The document is pure ASCII by construction (markers are validated below),
  // so latin1 encoding is byte-exact.
  return Uint8Array.from(full, (c) => c.charCodeAt(0) & 0xff);
}

/** Escape the three characters PDF literal strings reserve. */
function escapePdfString(s: string): string {
  if (!/^[\x20-\x7e]*$/.test(s)) {
    throw new Error(`PDF fixture marker must be printable ASCII, got: ${JSON.stringify(s)}`);
  }
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
