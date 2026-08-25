import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VISIBLE_MIN } from '../../ui/firma/smartPlacement.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(HERE, '../../../../../packages/verifier/tests/fixtures');

/**
 * Propiedades de las fixtures que sostienen `tests/e2e/colocacion-auto-individual.spec.ts`.
 *
 * Por qué existe: aquellos e2e valen SOLO si su fixture cumple una propiedad
 * concreta — «trae firma previa pero sin widget visible», «trae widget visible
 * que esquivar»— y esa propiedad no estaba asertada en ninguna parte. Si una
 * fixture se regenera y cambia, los e2e no se ponen rojos: pasan a verde
 * VACÍO, probando un camino distinto del que dicen probar. Esto lo convierte
 * en un rojo explicado.
 *
 * 🔴 Contar `/Rect` sobre el binario crudo NO sirve y llevó a elegir mal la
 * fixture una vez: estos PDFs llevan los objetos en streams comprimidos y la
 * expresión regular no los ve. La única medida válida es la que hace la app:
 * `page.getAnnotations()` de pdf.js, filtrado por `VISIBLE_MIN` — exactamente
 * lo que `scanSignatureWidgets` (PdfPreview.svelte) alimenta a
 * `computeSmartPlacement`.
 */
describe('propiedades de las fixtures de los e2e de colocación', () => {
  async function contarWidgetsVisibles(nombre: string): Promise<number> {
    // biome-ignore lint/suspicious/noExplicitAny: pdf.js no publica tipos para el build legacy
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(readFileSync(resolve(FIX, nombre)));
    const doc = await pdfjs.getDocument({ data, useWorkerFetch: false }).promise;
    let visibles = 0;
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      // biome-ignore lint/suspicious/noExplicitAny: idem
      const annots: any[] = await page.getAnnotations({ intent: 'display' });
      for (const a of annots) {
        if (a.subtype !== 'Widget' || a.fieldType !== 'Sig') continue;
        const r = a.rect;
        if (!Array.isArray(r) || r.length < 4) continue;
        if (Math.abs(r[2] - r[0]) > VISIBLE_MIN && Math.abs(r[3] - r[1]) > VISIBLE_MIN) {
          visibles += 1;
        }
      }
    }
    return visibles;
  }

  it('sample-b-b-no-tsa.pdf: firma previa SIN widget visible (el caso del default muerto)', async () => {
    // El e2e «con firma previa INVISIBLE y el motor caido» necesita justo esto:
    // `detectSignatures` cuenta la firma (solo mira /ByteRange) pero el
    // anti-solape no tiene nada que esquivar, así que `computeSmartPlacement`
    // devuelve null y sin la reactivación de `applySmartFallback` el paso 2 se
    // queda sin ninguna caja.
    expect(await contarWidgetsVisibles('sample-b-b-no-tsa.pdf')).toBe(0);
  });

  it('carta-arrendamiento-firmado.pdf: 1 widget visible (el anti-solape SÍ tiene qué esquivar)', async () => {
    expect(await contarWidgetsVisibles('carta-arrendamiento-firmado.pdf')).toBe(1);
  });

  it('audit-075-2026.pdf: 4 widgets visibles', async () => {
    expect(await contarWidgetsVisibles('audit-075-2026.pdf')).toBe(4);
  });

  it('eci-real-contrato2026.pdf: 1 widget VISIBLE — no sirve como "firma invisible"', async () => {
    // Contado sobre el binario daba 0 y por eso se eligió primero para el e2e
    // del default muerto: el test pasaba con el fix Y sin él, porque el
    // anti-solape colocaba igual. Queda asertado para que nadie repita el error.
    expect(await contarWidgetsVisibles('eci-real-contrato2026.pdf')).toBe(1);
  });
});
