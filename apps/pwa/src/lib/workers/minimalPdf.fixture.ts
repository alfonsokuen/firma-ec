/**
 * Generador de PDFs mínimos para los tests de esta carpeta — escrito a mano, a
 * propósito.
 *
 * Por qué no pdf-lib: `apps/pwa` NO depende de pdf-lib (ni debe: es lo que
 * `analyzePdfForPlacement` existe para evitar, ver
 * `packages/signer/src/analyzePdf.ts`). Un fixture que lo importara metería la
 * dependencia por la puerta de atrás. Estos bytes son un PDF 1.7 válido —
 * cabecera, objetos, tabla xref con offsets reales y trailer — así que el
 * pdf-lib que vive DENTRO del firmante los abre igual que un documento real.
 *
 * Solo cubre lo que la colocación automática necesita leer: `/MediaBox`,
 * `/CropBox`, `/Rotate` y widgets `/FT /Sig` en `/Annots`. Sin contenido de
 * página, sin fuentes: nada de eso influye en la geometría.
 */

/** `[x1, y1, x2, y2]` en pt. */
export type PdfBox = [number, number, number, number];

export interface FixtureWidget {
  /** `/Rect` del widget, tal cual va al PDF. */
  rect: PdfBox;
  /** `true` ⇒ el widget lleva `/V` (firma ya puesta). */
  signed?: boolean;
}

export interface FixturePage {
  mediaBox?: PdfBox;
  cropBox?: PdfBox;
  rotate?: 0 | 90 | 180 | 270;
  widgets?: FixtureWidget[];
}

const DEFAULT_MEDIA_BOX: PdfBox = [0, 0, 595.28, 841.89];

/** Longitud fija del campo de offset en una entrada de la tabla xref (PDF 32000-1 §7.5.4). */
const XREF_OFFSET_DIGITS = 10;

function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/**
 * Construye un PDF con una página por entrada de `pages`.
 *
 * Los objetos 1 y 2 quedan reservados para `/Catalog` y el nodo `/Pages`, de
 * modo que cada página puede apuntar a `2 0 R` como `/Parent` antes de que el
 * nodo exista.
 */
export function buildMinimalPdf(pages: FixturePage[]): Uint8Array {
  const objects: string[] = ['', ''];
  const push = (body: string): number => {
    objects.push(body);
    return objects.length; // número de objeto, 1-based
  };

  const kids: string[] = [];
  for (const page of pages) {
    const annotRefs: string[] = [];
    for (const [i, widget] of (page.widgets ?? []).entries()) {
      const value = widget.signed ? ' /V << /Type /Sig >>' : '';
      const num = push(
        `<< /Type /Annot /Subtype /Widget /FT /Sig /T (campo${i}) /Rect [ ${widget.rect.join(' ')} ]${value} >>`,
      );
      annotRefs.push(`${num} 0 R`);
    }
    const parts = [
      '/Type /Page',
      '/Parent 2 0 R',
      `/MediaBox [ ${(page.mediaBox ?? DEFAULT_MEDIA_BOX).join(' ')} ]`,
      '/Resources << >>',
    ];
    if (page.cropBox) parts.push(`/CropBox [ ${page.cropBox.join(' ')} ]`);
    if (page.rotate) parts.push(`/Rotate ${page.rotate}`);
    if (annotRefs.length > 0) parts.push(`/Annots [ ${annotRefs.join(' ')} ]`);
    kids.push(`${push(`<< ${parts.join(' ')} >>`)} 0 R`);
  }

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Count ${kids.length} /Kids [ ${kids.join(' ')} ] >>`;

  let body = '%PDF-1.7\n';
  const offsets: number[] = [];
  for (const [i, obj] of objects.entries()) {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  }
  const startxref = body.length;
  const size = objects.length + 1; // +1 por la entrada libre 0
  body += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(XREF_OFFSET_DIGITS, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  return latin1Bytes(body);
}

/** Igual que {@link buildMinimalPdf} pero devuelve el `ArrayBuffer` que espera `signNext`. */
export function buildMinimalPdfBuffer(pages: FixturePage[]): ArrayBuffer {
  return buildMinimalPdf(pages).slice().buffer as ArrayBuffer;
}
