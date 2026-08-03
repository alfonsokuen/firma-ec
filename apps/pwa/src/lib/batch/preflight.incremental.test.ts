import { describe, expect, it } from 'vitest';
import type { SignVisibleSigInput } from '../workers/sign-bus';
import type { PreflightItem } from './preflight';
import { splitPreflightWork } from './preflight';

/**
 * `splitPreflightWork` es lo que vuelve INCREMENTAL el paso 2 de
 * `FirmarLote.svelte` (`goToReview`): antes, cada entrada a revisión
 * reseteaba `preflight = []` y volvía a analizar el lote entero, incluso los
 * documentos que no cambiaron desde la última vez. Sin este helper (o con uno
 * que comparara por nombre/tamaño en vez de por referencia), un archivo
 * quitado-y-vuelto-a-elegir desde el picker del navegador —que crea un objeto
 * `File` nuevo aunque el nombre y el tamaño sean idénticos— se daría por
 * "ya analizado" y conservaría un resultado que en realidad nunca se calculó
 * para ESE objeto. Estos tests fijan que la identidad es por referencia.
 */

function fakeFile(name: string, size = 1024): File {
  const file = new File([new Uint8Array(size)], name, { type: 'application/pdf' });
  return file;
}

function itemFor(file: File, overrides: Partial<PreflightItem> = {}): PreflightItem {
  return {
    id: `pf-${file.name}`,
    file,
    status: 'ready',
    page: 0,
    pageCount: 1,
    ...overrides,
  };
}

describe('splitPreflightWork', () => {
  it('(a) primera vez: sin previo, todos los archivos son pending', () => {
    const a = fakeFile('a.pdf');
    const b = fakeFile('b.pdf');

    const { kept, pending } = splitPreflightWork([a, b], []);

    expect(kept).toEqual([]);
    expect(pending).toEqual([a, b]);
  });

  it('(b) un subconjunto ya tiene item previo, el resto es nuevo', () => {
    const a = fakeFile('a.pdf');
    const b = fakeFile('b.pdf');
    const c = fakeFile('c.pdf'); // nuevo, agregado en el paso 1 tras volver atrás
    const itemA = itemFor(a);
    const itemB = itemFor(b);

    const { kept, pending } = splitPreflightWork([a, b, c], [itemA, itemB]);

    expect(kept).toEqual([itemA, itemB]);
    expect(pending).toEqual([c]);
  });

  it('(c) un archivo quitado de la selección no aparece en kept', () => {
    const a = fakeFile('a.pdf');
    const b = fakeFile('b.pdf');
    const itemA = itemFor(a);
    const itemB = itemFor(b);

    // La persona quitó `b` antes de volver a entrar al paso 2.
    const { kept, pending } = splitPreflightWork([a], [itemA, itemB]);

    expect(kept).toEqual([itemA]);
    expect(kept).not.toContainEqual(itemB);
    expect(pending).toEqual([]);
  });

  it('(d) identidad por REFERENCIA: un File distinto con mismo nombre/tamaño es pending, no kept', () => {
    const original = fakeFile('a.pdf', 2048);
    const itemOriginal = itemFor(original);

    // Mismo nombre y mismo tamaño, pero objeto File DISTINTO — el caso real
    // de quitar y volver a elegir del picker del navegador.
    const reSelected = fakeFile('a.pdf', 2048);
    expect(reSelected).not.toBe(original);

    const { kept, pending } = splitPreflightWork([reSelected], [itemOriginal]);

    expect(kept).toEqual([]);
    expect(pending).toEqual([reSelected]);
  });

  it('(d bis) el MISMO objeto File vuelto a incluir sí cuenta como kept', () => {
    const a = fakeFile('a.pdf');
    const itemA = itemFor(a);

    const { kept, pending } = splitPreflightWork([a], [itemA]);

    expect(kept).toEqual([itemA]);
    expect(pending).toEqual([]);
  });

  it('un item kept con placement calculado lo conserva intacto', () => {
    const a = fakeFile('a.pdf');
    const placement = {
      page: 0,
      xPct: 0.5,
      yPct: 0.5,
      widthPct: 0.2,
      heightPct: 0.05,
    } as unknown as SignVisibleSigInput;
    const itemA = itemFor(a, { placement });

    const { kept } = splitPreflightWork([a], [itemA]);

    expect(kept).toHaveLength(1);
    expect(kept[0]?.placement).toBe(placement);
  });

  it('sin splitPreflightWork, el comportamiento viejo perdía TODO lo previo: el helper existe justo para evitar eso', () => {
    // Este test documenta la diferencia de comportamiento contra la que se
    // escribió el helper: `goToReview` antes hacía `preflight = []` seguido
    // de `preflightBatch(files, …)` sobre el lote ENTERO, sin importar qué ya
    // se había analizado. Simulamos ese reset ingenuo y confirmamos que
    // `splitPreflightWork` produce algo distinto (conserva lo que puede).
    const a = fakeFile('a.pdf');
    const b = fakeFile('b.pdf');
    const previous = [itemFor(a), itemFor(b)];

    const naiveReset: { kept: PreflightItem[]; pending: File[] } = { kept: [], pending: [a, b] };
    const incremental = splitPreflightWork([a, b], previous);

    expect(incremental.kept).toHaveLength(2);
    expect(incremental.pending).toHaveLength(0);
    expect(incremental).not.toEqual(naiveReset);
  });
});
