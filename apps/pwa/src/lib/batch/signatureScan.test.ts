import { describe, expect, it } from 'vitest';
import {
  SCAN_FULL_MAX_PAGES,
  SCAN_TAIL_PAGES,
  type ScannableAnnotation,
  type ScannableDoc,
  type ScannablePage,
  scanSignatureWidgets,
} from './signatureScan.ts';

/** Widget de firma con rect visible. */
const firma = (x: number, y: number, w = 200, h = 60): ScannableAnnotation => ({
  subtype: 'Widget',
  fieldType: 'Sig',
  rect: [x, y, x + w, y + h],
});

interface PaginaFalsa {
  annots?: ScannableAnnotation[];
  /** La página entera es inaccesible (`getPage` revienta). */
  rompePagina?: boolean;
  /** La página se abre pero sus anotaciones no parsean. */
  rompeAnnots?: boolean;
}

function docFalso(paginas: PaginaFalsa[]): ScannableDoc {
  return {
    numPages: paginas.length,
    async getPage(n: number): Promise<ScannablePage> {
      const p = paginas[n - 1];
      if (!p || p.rompePagina) throw new Error('page unavailable');
      return {
        getViewport: () => ({ width: 612, height: 792 }),
        getAnnotations: async () => {
          if (p.rompeAnnots) throw new Error('annotation dict corrupt');
          return p.annots ?? [];
        },
      };
    },
  };
}

describe('scanSignatureWidgets — no confundir "no hay firmas" con "no pude mirar"', () => {
  it('documento sano: encuentra los widgets y se declara completo', async () => {
    const r = await scanSignatureWidgets(docFalso([{ annots: [firma(18, 40)] }, {}]));
    expect(r.widgets).toEqual([{ page: 0, x: 18, y: 40, w: 200, h: 60 }]);
    expect(r.incomplete).toBe(false);
    expect(r.failedPages).toBe(0);
    expect(r.pageDims).toHaveLength(2);
  });

  it('documento SIN firmas: completo, y eso es una afirmación válida', async () => {
    const r = await scanSignatureWidgets(docFalso([{}, {}]));
    expect(r.widgets).toEqual([]);
    expect(r.incomplete).toBe(false);
  });

  describe('🔴 el defecto P0: una página que no se puede mirar', () => {
    it('anotaciones corruptas ⇒ incomplete, NO "sin firmas"', async () => {
      // Antes: `catch { annots = [] }` y el resultado salía idéntico al de un
      // documento limpio. Aguas abajo, el sello podía acabar encima de la firma
      // de un co-firmante sin que nada avisara.
      const r = await scanSignatureWidgets(docFalso([{ rompeAnnots: true }, {}]));
      expect(r.widgets).toEqual([]);
      expect(r.incomplete).toBe(true);
      expect(r.failedPages).toBe(1);
    });

    it('página entera inaccesible ⇒ incomplete', async () => {
      const r = await scanSignatureWidgets(docFalso([{ rompePagina: true }, {}]));
      expect(r.incomplete).toBe(true);
      expect(r.failedPages).toBe(1);
    });

    it('lo que SÍ se pudo leer se conserva: degradar no es rendirse', async () => {
      // La página 2 falla, pero la firma de la 1 sigue siendo información útil
      // para esquivar. Devolver [] entero sería tirar una defensa real.
      const r = await scanSignatureWidgets(
        docFalso([{ annots: [firma(18, 40)] }, { rompeAnnots: true }]),
      );
      expect(r.widgets).toHaveLength(1);
      expect(r.incomplete).toBe(true);
    });

    it('cuenta TODAS las páginas fallidas, no solo la primera', async () => {
      const r = await scanSignatureWidgets(
        docFalso([{ rompeAnnots: true }, {}, { rompePagina: true }, { rompeAnnots: true }]),
      );
      expect(r.failedPages).toBe(3);
      expect(r.incomplete).toBe(true);
    });

    it('un documento entero ilegible no lanza: devuelve incomplete', async () => {
      // Quien llama está pintando una vista previa; una excepción aquí tumbaría
      // el flujo entero por algo que tiene un camino degradado válido.
      const r = await scanSignatureWidgets(docFalso([{ rompePagina: true }]));
      expect(r.incomplete).toBe(true);
      expect(r.widgets).toEqual([]);
      expect(r.pageDims).toEqual([]);
    });
  });

  describe('qué se ignora', () => {
    it('anotaciones que no son widgets de firma', async () => {
      const r = await scanSignatureWidgets(
        docFalso([
          {
            annots: [
              { subtype: 'Link', fieldType: 'Sig', rect: [0, 0, 10, 10] },
              { subtype: 'Widget', fieldType: 'Tx', rect: [0, 0, 10, 10] },
              firma(18, 40),
            ],
          },
        ]),
      );
      expect(r.widgets).toHaveLength(1);
      expect(r.incomplete).toBe(false);
    });

    it('rect ausente o mal formado se salta SIN marcar incompleto', async () => {
      // No es un fallo de lectura: es una firma invisible, que es legítima.
      const r = await scanSignatureWidgets(
        docFalso([
          {
            annots: [
              { subtype: 'Widget', fieldType: 'Sig' },
              { subtype: 'Widget', fieldType: 'Sig', rect: [1, 2] },
              { subtype: 'Widget', fieldType: 'Sig', rect: [0, 0, Number.NaN, 10] },
            ],
          },
        ]),
      );
      expect(r.widgets).toEqual([]);
      expect(r.incomplete).toBe(false);
    });

    it('normaliza el rect invertido a x/y mínimos y anchos positivos', async () => {
      const r = await scanSignatureWidgets(
        docFalso([{ annots: [{ subtype: 'Widget', fieldType: 'Sig', rect: [218, 100, 18, 40] }] }]),
      );
      expect(r.widgets[0]).toEqual({ page: 0, x: 18, y: 40, w: 200, h: 60 });
    });
  });

  describe('tope de páginas', () => {
    it(`hasta ${SCAN_FULL_MAX_PAGES} páginas recorre el documento entero`, async () => {
      const r = await scanSignatureWidgets(docFalso(Array(SCAN_FULL_MAX_PAGES).fill({})));
      expect(r.pageDims).toHaveLength(SCAN_FULL_MAX_PAGES);
      expect(r.pageDims[0]?.page).toBe(0);
    });

    it(`por encima del tope solo mira las últimas ${SCAN_TAIL_PAGES} (las firmas van al final)`, async () => {
      const total = SCAN_FULL_MAX_PAGES + 10;
      const paginas: PaginaFalsa[] = Array(total).fill({});
      paginas[0] = { annots: [firma(18, 40)] }; // firma en la primera: fuera de la cola
      paginas[total - 1] = { annots: [firma(30, 50)] };
      const r = await scanSignatureWidgets(docFalso(paginas));
      expect(r.pageDims).toHaveLength(SCAN_TAIL_PAGES);
      // La firma de la página 0 no se ve — es el precio conocido del tope, y
      // NO se reporta como incompleto: es una decisión, no un fallo.
      expect(r.widgets).toHaveLength(1);
      expect(r.widgets[0]?.page).toBe(total - 1);
      expect(r.incomplete).toBe(false);
    });
  });
});
