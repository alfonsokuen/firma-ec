/**
 * La estampa no debe caer encima del texto.
 *
 * ⚠️ Estas pruebas nacieron mal y se rehicieron: la primera versión comparaba
 * la estampa contra `analysis.textBands`, es decir contra las MISMAS bandas que
 * el algoritmo había usado para decidir. Eso no puede fallar nunca — si las
 * bandas están mal, la estampa está mal y la prueba pasa igual. De hecho pasaba
 * con las bandas de `audit-075-firmado.pdf` cayendo en y = −183, fuera del
 * papel.
 *
 * Aquí toda verdad de referencia es INDEPENDIENTE del módulo que se prueba:
 *   1. Documentos sintéticos donde el texto se pone en coordenadas que decide
 *      la propia prueba (§1 y §3).
 *   2. `pdfjs-dist` como oráculo externo para los documentos reales (§4): otra
 *      implementación de PDF, escrita por otra gente, dice dónde está el texto.
 *   3. La tabla congelada del algoritmo ANTERIOR a que existieran las bandas
 *      (§2), extraída ejecutando ese código sobre el corpus.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { analyzePdfForPlacement } from '../src/analyzePdf.js';
import { computeAutoPlacement } from '../src/autoPlacement.js';
import { readTextBands } from '../src/textBands.js';

const VERIFIER_FIXTURES = join(__dirname, '..', '..', 'verifier', 'tests', 'fixtures');
const E2E_FIXTURES = join(__dirname, '..', '..', '..', 'apps', 'pwa', 'tests', 'e2e', 'fixtures');

/** El corpus vive repartido en dos paquetes; se busca por nombre, no por prefijo. */
function fixture(name: string): string {
  const candidate = join(VERIFIER_FIXTURES, name);
  return existsSync(candidate) ? candidate : join(E2E_FIXTURES, name);
}

/** PDF de una página cuyo content stream se escribe a mano, byte a byte. */
async function pdfWithRawContent(
  content: string,
  extra?: (doc: PDFDocument, page: ReturnType<PDFDocument['addPage']>) => void,
): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  await doc.embedFont(StandardFonts.Helvetica);
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(content)));
  extra?.(doc, page);
  return PDFDocument.load(await doc.save());
}

/**
 * Añade un Image XObject `/Im0` a la página. Los bytes no importan: el lector
 * de bandas nunca decodifica una imagen — le basta el `/Subtype` y la CTM con
 * la que se coloca para saber cuánto papel tapa.
 */
function withFakeImage(doc: PDFDocument, page: ReturnType<PDFDocument['addPage']>): void {
  const image = doc.context.register(
    doc.context.stream(new Uint8Array([0]), {
      Type: PDFName.of('XObject'),
      Subtype: PDFName.of('Image'),
      Width: 1,
      Height: 1,
      ColorSpace: PDFName.of('DeviceGray'),
      BitsPerComponent: 8,
    }),
  );
  const resources = page.node.Resources();
  if (!resources) throw new Error('la página del fixture no tiene /Resources');
  resources.set(PDFName.of('XObject'), doc.context.obj({ Im0: image }));
}

/** ¿Alguna banda cubre `y`? */
function covers(bands: readonly { y: number; h: number }[], y: number): boolean {
  return bands.some((b) => b.y <= y && y <= b.y + b.h);
}

describe('readTextBands lee posiciones REALES, no las que le convienen', () => {
  it('sitúa cada línea donde la prueba la puso', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 600]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Cláusula primera', { x: 50, y: 500, size: 12, font });
    page.drawText('Cláusula segunda', { x: 50, y: 60, size: 12, font });

    const { bands, unanalyzedPages } = readTextBands(await PDFDocument.load(await doc.save()));

    expect(unanalyzedPages).toEqual([]);
    expect(covers(bands, 500)).toBe(true);
    expect(covers(bands, 60)).toBe(true);
    // Y NO inventa texto donde la prueba no puso ninguno.
    expect(covers(bands, 300)).toBe(false);
  });

  it('aplica la CTM invertida de Google Docs/Skia', async () => {
    // `1 0 0 -1 0 792 cm` refleja el eje vertical: el texto escrito en y = 100
    // del espacio de texto se DIBUJA en y = 692 del papel. Sin interpretar la
    // matriz, la banda salía en 100 y la estampa aterrizaba sobre las letras
    // creyendo que 692 era blanco.
    const pdf = await pdfWithRawContent(
      'q 1 0 0 -1 0 792 cm BT /F1 12 Tf 1 0 0 1 72 100 Tm (Texto) Tj ET Q',
    );
    const { bands, unanalyzedPages } = readTextBands(pdf);

    expect(unanalyzedPages).toEqual([]);
    expect(covers(bands, 692)).toBe(true);
    expect(covers(bands, 100)).toBe(false);
    // Y ninguna banda se sale del papel: eso delataba el defecto.
    expect(bands.every((b) => b.y >= -2 && b.y + b.h <= 794)).toBe(true);
  });

  it('ignora el texto invisible de una capa OCR (3 Tr)', async () => {
    const visible = await pdfWithRawContent('BT /F1 12 Tf 1 0 0 1 72 400 Tm (Hola) Tj ET');
    const invisible = await pdfWithRawContent('BT 3 Tr /F1 12 Tf 1 0 0 1 72 400 Tm (Hola) Tj ET');

    expect(covers(readTextBands(visible).bands, 400)).toBe(true);
    // Sigue sin generar bandas: la capa OCR cubre la hoja entera y contarla
    // apartaría documentos sin una sola letra visible estorbando.
    expect(readTextBands(invisible).bands).toEqual([]);
    // Pero YA NO se confunde con una hoja en blanco. Devolver `[]` a secas
    // dejaba al algoritmo creyéndose dueño de la página, cuando lo que hay
    // debajo es un escaneo con todo su texto en píxeles.
    expect(readTextBands(invisible).ocrOnlyPages).toEqual([0]);
    expect(readTextBands(invisible).unanalyzedPages).toEqual([0]);
  });

  it('una imagen que tapa la hoja en una página sin texto es un escaneo, no papel virgen', async () => {
    // Sin esto, un contrato escaneado devolvía exactamente lo mismo que una
    // hoja en blanco —cero bandas— y el algoritmo se creía dueño de la página.
    const escaneo = await pdfWithRawContent('q 612 0 0 792 0 0 cm /Im0 Do Q', withFakeImage);
    const result = readTextBands(escaneo);

    expect(result.bands).toEqual([]);
    expect(result.imageOnlyPages).toEqual([0]);
    expect(result.unanalyzedPages).toEqual([0]);
  });

  it('un logo pequeño en una página sin texto NO es un escaneo', async () => {
    // El otro plato de la balanza: bajar el umbral hasta cazar membretes
    // apartaría del análisis páginas perfectamente legibles.
    const conLogo = await pdfWithRawContent('q 100 0 0 50 0 0 cm /Im0 Do Q', withFakeImage);
    const result = readTextBands(conLogo);

    expect(result.imageOnlyPages).toEqual([]);
    expect(result.unanalyzedPages).toEqual([]);
  });

  it('una imagen a toda página CON texto encima es un fondo, y el recorrido vale', async () => {
    const conFondo = await pdfWithRawContent(
      'q 612 0 0 792 0 0 cm /Im0 Do Q BT /F1 12 Tf 1 0 0 1 72 400 Tm (Contrato) Tj ET',
      withFakeImage,
    );
    const result = readTextBands(conFondo);

    expect(result.imageOnlyPages).toEqual([]);
    expect(result.unanalyzedPages).toEqual([]);
    expect(covers(result.bands, 400)).toBe(true);
  });

  it('con texto visible encima, la capa OCR no marca nada: es un PDF mixto normal', async () => {
    const mixto = await pdfWithRawContent(
      // El `0 Tr` del segundo bloque no es adorno: el modo de render es estado
      // gráfico y sobrevive al `ET`, así que sin él el texto "visible" también
      // saldría invisible.
      'BT 3 Tr /F1 12 Tf 1 0 0 1 72 400 Tm (oculto) Tj ET ' +
        'BT 0 Tr /F1 12 Tf 1 0 0 1 72 600 Tm (visible) Tj ET',
    );
    const result = readTextBands(mixto);

    // La ceguera solo se declara cuando NO queda una sola letra visible. Aquí
    // el recorrido sirve, así que la página se analiza como cualquier otra.
    expect(result.ocrOnlyPages).toEqual([]);
    expect(result.unanalyzedPages).toEqual([]);
    expect(covers(result.bands, 600)).toBe(true);
  });

  it('entra en un Form XObject y compone su /Matrix', async () => {
    // El texto vive dentro del formulario en y = 10; la /Matrix del formulario
    // lo traslada a y = 310 del papel.
    const pdf = await pdfWithRawContent('q /Fx1 Do Q', (doc, page) => {
      const form = doc.context.stream('BT /F1 12 Tf 1 0 0 1 20 10 Tm (Dentro) Tj ET', {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 300, 100],
        Matrix: [1, 0, 0, 1, 0, 300],
      });
      const xobjects = doc.context.obj({ Fx1: doc.context.register(form) });
      page.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: xobjects }));
    });

    const { bands, unanalyzedPages } = readTextBands(pdf);

    expect(unanalyzedPages).toEqual([]);
    expect(covers(bands, 310)).toBe(true);
    expect(covers(bands, 10)).toBe(false);
  });

  it('el MISMO formulario colocado dos veces deja DOS bandas, no una', async () => {
    // Una plantilla reutilizada —membrete, pie, casilla— es un solo XObject
    // dibujado con dos CTMs. Si el corte de ciclos lo confunde con una vuelta
    // al mismo sitio, la segunda copia desaparece y la página se declara
    // analizada entera: la estampa cae encima del texto que nadie vio.
    const pdf = await pdfWithRawContent(
      'q 1 0 0 1 0 690 cm /Fx1 Do Q q 1 0 0 1 0 30 cm /Fx1 Do Q',
      (doc, page) => {
        const form = doc.context.stream('BT /F1 12 Tf 1 0 0 1 20 10 Tm (Repetido) Tj ET', {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, 300, 100],
        });
        const xobjects = doc.context.obj({ Fx1: doc.context.register(form) });
        page.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: xobjects }));
      },
    );

    const { bands, unanalyzedPages } = readTextBands(pdf);

    expect(unanalyzedPages).toEqual([]);
    expect(covers(bands, 700)).toBe(true);
    expect(covers(bands, 40)).toBe(true);
  });

  it('un `3 Tr` dentro de q…Q NO ciega el resto de la página', async () => {
    // `Tr` es estado gráfico: sobrevive al `ET` —eso ya está probado arriba— y
    // por lo mismo `Q` DEBE restaurarlo. Sin eso, la capa OCR de un escaneo se
    // derrama sobre el texto de verdad que venga después.
    const pdf = await pdfWithRawContent(
      'BT /F1 12 Tf 1 0 0 1 60 700 Tm (Encabezado) Tj ET ' +
        'q BT 3 Tr /F1 12 Tf 1 0 0 1 60 400 Tm (capa ocr) Tj ET Q ' +
        'BT /F1 12 Tf 1 0 0 1 60 40 Tm (Clausula al pie) Tj ET',
    );

    const { bands, ocrOnlyPages, unanalyzedPages } = readTextBands(pdf);

    expect(covers(bands, 700)).toBe(true);
    expect(covers(bands, 40)).toBe(true);
    expect(covers(bands, 400)).toBe(false);
    // Queda texto visible de sobra: esta página no es un escaneo.
    expect(ocrOnlyPages).toEqual([]);
    expect(unanalyzedPages).toEqual([]);
  });

  it('el mismo dibujo repetido no cuenta como papel tapado dos veces', async () => {
    // `|det(CTM)|` mide UNA imagen. Sumarlas es sumar áreas, no unirlas: siete
    // copias en el mismo sitio tapan lo mismo que una, y una portada por capas
    // no es un escaneo.
    const pdf = await pdfWithRawContent(
      Array.from({ length: 7 }, () => 'q 200 0 0 200 100 300 cm /Im0 Do Q').join(' '),
      withFakeImage,
    );

    // 7 × 200×200 = 280.000 pt² sumados, pero solo 40.000 pt² de papel tapado
    // sobre una hoja de 484.704 pt²: 8,3 %, muy lejos del umbral.
    expect(readTextBands(pdf).imageOnlyPages).toEqual([]);
  });

  it('una página que no se puede descomprimir sale como NO analizada, no como vacía', async () => {
    const pdf = await pdfWithRawContent('BT /F1 12 Tf 1 0 0 1 72 400 Tm (Hola) Tj ET');
    const contents = pdf.getPage(0).node.get(PDFName.of('Contents'));
    const stream = pdf.context.lookup(contents);
    expect(stream).toBeInstanceOf(PDFRawStream);
    (stream as PDFRawStream).dict.set(PDFName.of('Filter'), PDFName.of('JPXDecode'));

    const result = readTextBands(pdf);

    // Lo que NO puede pasar: `bands: []` con `unanalyzedPages: []`, que la
    // colocación leería como "hoja en blanco, coloca donde quieras".
    expect(result.unanalyzedPages).toEqual([0]);
  });
});

/**
 * Tabla congelada del algoritmo ANTERIOR a las bandas (`autoPlacement.ts` en
 * 485cc3e~1), obtenida ejecutando ESE código sobre el corpus. Es la red que
 * sostiene la promesa del módulo: sin bandas —porque el documento no se pudo
 * recorrer— nadie firma en un sitio distinto al de siempre.
 */
const LEGACY_WITHOUT_BANDS: Record<string, string> = {
  'audit-075-2026.pdf': 'ok p3 x=18.0 y=651.7 w=240.0 h=72.0 anti-overlap',
  'audit-075-firmado.pdf': 'ok p3 x=18.0 y=651.7 w=240.0 h=72.0 anti-overlap',
  'bb-valid.pdf': 'ok p0 x=177.5 y=18.0 w=240.0 h=72.0 default-footer',
  'carta-arrendamiento-firmado.pdf': 'ok p0 x=18.0 y=181.0 w=240.0 h=72.0 anti-overlap',
  'eci-real-contrato2026.pdf': 'ok p3 x=18.0 y=301.0 w=240.0 h=72.0 anti-overlap',
  'eci-real-lideres.pdf': 'ok p3 x=18.0 y=300.0 w=240.0 h=72.0 anti-overlap',
  'eci-real-signed.pdf': 'ok p3 x=210.0 y=387.0 w=240.0 h=72.0 anti-overlap',
  'expired-cert.pdf': 'ok p0 x=177.5 y=18.0 w=240.0 h=72.0 default-footer',
  'hash-mismatch.pdf': 'REVIEW p0 document_unreadable',
  'incremental-tampered.pdf': 'ok p0 x=177.5 y=18.0 w=240.0 h=72.0 default-footer',
  'rsa-1024.pdf': 'ok p0 x=177.5 y=18.0 w=240.0 h=72.0 default-footer',
  'sample-b-b-no-tsa.pdf': 'ok p0 x=177.6 y=18.0 w=240.0 h=72.0 default-footer',
  'sample-b-t-freetsa.pdf': 'ok p0 x=177.6 y=18.0 w=240.0 h=72.0 default-footer',
  'sample-b-t.pdf': 'ok p0 x=177.6 y=18.0 w=240.0 h=72.0 default-footer',
  'sample.pdf': 'ok p0 x=177.6 y=18.0 w=240.0 h=72.0 default-footer',
  'unsigned.pdf': 'ok p0 x=177.5 y=18.0 w=240.0 h=72.0 default-footer',
  'untrusted-root.pdf': 'ok p0 x=177.5 y=18.0 w=240.0 h=72.0 default-footer',
  'weak-sha1.pdf': 'ok p0 x=177.5 y=18.0 w=240.0 h=72.0 default-footer',
};

/**
 * Tabla congelada de la colocación ACTUAL, con bandas. Complementa a
 * {@link LEGACY_WITHOUT_BANDS}, que solo sujeta el camino sin bandas — le pasa
 * `computeAutoPlacement` sin `textBands` ni `unanalyzedPages`, así que el
 * camino por el que pasan de verdad los documentos no estaba sujeto por nada.
 *
 * Diez de estas dieciocho entradas difieren de la tabla legacy: eso es
 * exactamente lo que las bandas cambiaron, y es lo que hay que poder ver
 * moverse. Un cambio en el análisis del texto que altere una sola de estas
 * líneas tiene que ser una decisión, no un efecto colateral.
 */
const CURRENT_WITH_BANDS: Record<string, string> = {
  // MOVIDA (segundo firmante, 2026-08-26): antes x=18.0, el borde de la hoja.
  // Es un movimiento LATERAL, no una mejora, y conviene decirlo: en esta
  // pagina el hueco reservado cae en el PIE, asi que la banda que hay debajo
  // --de la que sale la alineacion-- es la linea "Pagina 4 de 4". Anclar al
  // numero de pagina no significa nada; anclar al borde de la hoja tampoco.
  // Ninguna de las dos posiciones es buena y el documento seguira mal puesto
  // hasta que el anclaje sepa distinguir un bloque de firma de un pie.
  'audit-075-2026.pdf': 'ok p3 x=354.0 y=69.7 w=240.0 h=72.0 anti-overlap',
  'audit-075-firmado.pdf': 'ok p3 x=354.0 y=69.7 w=240.0 h=72.0 anti-overlap',
  'bb-valid.pdf': 'ok p0 x=177.5 y=18.0 w=240.0 h=72.0 default-footer',
  'carta-arrendamiento-firmado.pdf': 'REVIEW p0 no_free_slot',
  // MOVIDAS (segundo firmante, 2026-08-26), y estas SI son la mejora que
  // motivo el cambio. Las dos son contratos con bloque de firma a dos
  // columnas y una firma previa, o sea el caso del segundo firmante: antes la
  // estampa se iba a x=18.0 y=67.6, el borde inferior izquierdo de la hoja,
  // a 270 pt del sitio donde toca. Ahora la `x` es el arranque EXACTO de la
  // columna izquierda del bloque (63.9 y 140.3 respectivamente, medidos con
  // pdfminer sobre la pagina 4 de cada uno).
  //
  // La `y` sigue quedando alta dentro del hueco --no se apoya sobre la raya,
  // flota unos 50 pt por encima-- porque el hueco se busca por franjas
  // horizontales de pagina completa: una firma previa a la derecha bloquea
  // toda la altura, aunque no estorbe a la columna izquierda. Esa segunda
  // vuelta esta pendiente.
  // MOVIDA otra vez (hueco por columna, 2026-08-26): y=344 -> 298.4. La firma
  // previa vive en u 334..444 --la columna del OTRO firmante-- y NO toca el
  // span de esta caja (56.9..310.9), asi que ya no levanta el suelo del hueco:
  // la estampa baja a apoyarse sobre el nombre del bloque izquierdo (top
  // ~291.4 + GAP/2), igual que la firma previa se apoya sobre el suyo.
  'eci-real-contrato2026.pdf': 'ok p3 x=63.9 y=298.4 w=240.0 h=72.0 anti-overlap',
  // SIN cambio con el hueco por columna, y el contraste con contrato2026 es
  // deliberado documentarlo: aqui el bloque arranca en x=140.3, la caja de 240
  // llega hasta 387.3 y la firma previa empieza en u=364 -- SI interseca el
  // span, no se filtra, y el suelo alto es real (la caja pasaria por debajo de
  // la firma previa), no un artefacto de franjas de pagina completa.
  'eci-real-lideres.pdf': 'ok p3 x=140.3 y=343.0 w=240.0 h=72.0 anti-overlap',
  'eci-real-signed.pdf': 'ok p3 x=18.0 y=18.0 w=240.0 h=72.0 anti-overlap',
  'expired-cert.pdf': 'ok p0 x=177.5 y=18.0 w=240.0 h=72.0 default-footer',
  'hash-mismatch.pdf': 'REVIEW p0 document_unreadable',
  'incremental-tampered.pdf': 'ok p0 x=177.5 y=18.0 w=240.0 h=72.0 default-footer',
  'rsa-1024.pdf': 'ok p0 x=177.5 y=18.0 w=240.0 h=72.0 default-footer',
  'sample-b-b-no-tsa.pdf': 'ok p0 x=177.6 y=18.0 w=240.0 h=72.0 free-space',
  'sample-b-t-freetsa.pdf': 'ok p0 x=177.6 y=18.0 w=240.0 h=72.0 free-space',
  'sample-b-t.pdf': 'ok p0 x=177.6 y=18.0 w=240.0 h=72.0 free-space',
  'sample.pdf': 'ok p0 x=177.6 y=18.0 w=240.0 h=72.0 free-space',
  'unsigned.pdf': 'ok p0 x=177.5 y=18.0 w=240.0 h=72.0 default-footer',
  'untrusted-root.pdf': 'ok p0 x=177.5 y=18.0 w=240.0 h=72.0 default-footer',
  'weak-sha1.pdf': 'ok p0 x=177.5 y=18.0 w=240.0 h=72.0 default-footer',
};

describe('con bandas, la colocación es la que hay hoy', () => {
  for (const [name, expected] of Object.entries(CURRENT_WITH_BANDS)) {
    it(name, async () => {
      const analysis = await analyzePdfForPlacement(new Uint8Array(readFileSync(fixture(name))));
      const placement = computeAutoPlacement({
        geometry: analysis.geometry,
        existing: analysis.existing,
        emptySigFields: analysis.emptySigFields,
        textBands: analysis.textBands,
        unanalyzedPages: analysis.unanalyzedPages,
        ...(analysis.failure ? { failure: analysis.failure } : {}),
      });

      expect(describePlacement(placement)).toBe(expected);
    });
  }
});

/** Las dos tablas describen el MISMO corpus: si una crece y la otra no, falta cobertura. */
describe('las dos tablas congeladas cubren lo mismo', () => {
  it('mismo conjunto de documentos', () => {
    expect(Object.keys(CURRENT_WITH_BANDS).sort()).toEqual(
      Object.keys(LEGACY_WITHOUT_BANDS).sort(),
    );
  });

  it('y difieren en 10, que es lo que las bandas cambiaron', () => {
    // No es un número mágico: es la medida de cuánto se apartó el algoritmo del
    // comportamiento de siempre. Si sube sin querer, alguien movió el análisis
    // de texto y no se enteró.
    const distintos = Object.keys(CURRENT_WITH_BANDS).filter(
      (k) => CURRENT_WITH_BANDS[k] !== LEGACY_WITHOUT_BANDS[k],
    );
    expect(distintos).toHaveLength(10);
  });
});

function describePlacement(p: ReturnType<typeof computeAutoPlacement>): string {
  return p.status === 'ok'
    ? `ok p${p.page} x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} w=${p.w.toFixed(1)} h=${p.h.toFixed(1)} ${p.source}`
    : `REVIEW p${p.page} ${p.reason}`;
}

describe('sin bandas, la colocación es la de SIEMPRE', () => {
  for (const [name, expected] of Object.entries(LEGACY_WITHOUT_BANDS)) {
    it(name, async () => {
      const analysis = await analyzePdfForPlacement(new Uint8Array(readFileSync(fixture(name))));
      const placement = computeAutoPlacement({
        geometry: analysis.geometry,
        existing: analysis.existing,
        emptySigFields: analysis.emptySigFields,
        ...(analysis.failure ? { failure: analysis.failure } : {}),
      });

      expect(describePlacement(placement)).toBe(expected);
    });
  }
});

/**
 * Oráculo externo: `pdfjs-dist` extrae la posición de cada fragmento de texto.
 * Es otra implementación de PDF, independiente de `textBands.ts`, así que si mi
 * lector se equivoca el oráculo NO se equivoca con él.
 *
 * Privacidad: solo se usa `str` para saber si el fragmento está en blanco.
 * Ningún contenido se imprime ni se compara.
 */
interface TextRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

async function textRectsByPage(bytes: Uint8Array): Promise<Map<number, TextRect[]>> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const byPage = new Map<number, TextRect[]>();

  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const rects: TextRect[] = [];
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim().length === 0) continue;
      // `transform` es [a b c d e f] en espacio de usuario; e/f es el origen de
      // la línea base y `height` el alto del fragmento.
      const [, , , , e, f] = item.transform as number[];
      const h = Math.abs(item.height) || 1;
      rects.push({ x: e!, y: f! - h * 0.25, w: Math.abs(item.width) || 1, h: h * 1.1 });
    }
    byPage.set(i - 1, rects);
  }
  await doc.destroy();
  return byPage;
}

function overlaps(a: TextRect, b: TextRect): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

describe('en documentos REALES la estampa no cae sobre el texto (oráculo pdf.js)', () => {
  const REAL_DOCS = [
    'eci-real-lideres.pdf',
    'carta-arrendamiento-firmado.pdf',
    'audit-075-firmado.pdf',
    'eci-real-contrato2026.pdf',
    'eci-real-signed.pdf',
    'sample.pdf',
  ];

  for (const name of REAL_DOCS) {
    it(name, async () => {
      const bytes = new Uint8Array(readFileSync(fixture(name)));
      const analysis = await analyzePdfForPlacement(bytes);
      const placement = computeAutoPlacement({
        geometry: analysis.geometry,
        existing: analysis.existing,
        emptySigFields: analysis.emptySigFields,
        textBands: analysis.textBands,
        unanalyzedPages: analysis.unanalyzedPages,
      });

      // Apartar el documento es una respuesta legítima: mejor sin firmar que
      // firmado encima de una cláusula. Pero NO puede ser la respuesta a todo,
      // así que el corpus fija abajo cuántos se apartan.
      if (placement.status !== 'ok') return;

      const stamp: TextRect = {
        x: placement.x,
        y: placement.y,
        w: placement.w,
        h: placement.h,
      };
      const onPage = (await textRectsByPage(bytes)).get(placement.page) ?? [];
      const hits = onPage.filter((t) => overlaps(stamp, t));

      expect(hits.length, `${hits.length} fragmentos de texto bajo la estampa`).toBe(0);
    });
  }

  it('el corpus no se aparta en bloque: la mayoría sigue firmándose sola', async () => {
    let ok = 0;
    for (const name of REAL_DOCS) {
      const analysis = await analyzePdfForPlacement(new Uint8Array(readFileSync(fixture(name))));
      const placement = computeAutoPlacement({
        geometry: analysis.geometry,
        existing: analysis.existing,
        emptySigFields: analysis.emptySigFields,
        textBands: analysis.textBands,
        unanalyzedPages: analysis.unanalyzedPages,
      });
      if (placement.status === 'ok') ok += 1;
    }
    // 5 de 6: solo `carta-arrendamiento-firmado.pdf` se aparta, y está escrito
    // de arriba abajo con huecos de 30 pt como mucho — no cabe una estampa de
    // 72 pt en ninguno.
    expect(ok).toBe(5);
  });
});
