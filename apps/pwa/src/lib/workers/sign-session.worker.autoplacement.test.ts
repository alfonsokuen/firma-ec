/**
 * Colocación automática DENTRO del worker de sesión (hueco #2, lado worker).
 *
 * El worker es quien tiene los bytes del PDF y quien puede importar el
 * firmante, así que el análisis vive aquí: `analyzePdfForPlacement` →
 * `computeAutoPlacement` → `visibleSig` de ESTE documento. Transferir el PDF a
 * la hebra principal para analizarlo y devolverlo sería mandarlo dos veces.
 *
 * Lo que se fija (criterios 2, 3 y 4 de la tarea):
 *   - 3 documentos heterogéneos (plano · `/Rotate 90` · `CropBox` < `MediaBox`)
 *     con colocación automática: los tres se firman, cada rect cae DENTRO del
 *     área visible de su propia página y lleva el `rotate` de esa página. Con
 *     `/Rotate 90` el rect va con las dimensiones intercambiadas (h×w).
 *   - un campo de firma vacío se respeta tal cual (no se recoloca).
 *   - `MediaBox` con origen desplazado ⇒ `needs_review`: NO se firma y el
 *     motivo se reporta.
 *
 * `signPdfPades` está mockeado (firmar de verdad exige un .p12), pero TODO el
 * camino de colocación es real: bytes → pdf-lib → geometría → placement.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FixturePage, type PdfBox, buildMinimalPdfBuffer } from './minimalPdf.fixture';

const parsePfxMock = vi.fn();
const signPdfPadesMock = vi.fn();
const addIncrementalSignatureMock = vi.fn();
const detectSignaturesMock = vi.fn();

vi.mock('@firma-ec/signer', async () => {
  const actual = await vi.importActual<typeof import('@firma-ec/signer')>('@firma-ec/signer');
  return {
    ...actual,
    parsePfx: (...args: unknown[]) => parsePfxMock(...args),
    signPdfPades: (...args: unknown[]) => signPdfPadesMock(...args),
    addIncrementalSignature: (...args: unknown[]) => addIncrementalSignatureMock(...args),
    detectSignatures: (...args: unknown[]) => detectSignaturesMock(...args),
  };
});

class FakeWorkerScope extends EventTarget {
  public readonly posted: { kind: string; [k: string]: unknown }[] = [];

  postMessage(msg: unknown): void {
    this.posted.push(msg as { kind: string });
  }

  send(data: unknown): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data }));
  }

  find(kind: string): { kind: string; [k: string]: unknown } | undefined {
    return this.posted.find((m) => m.kind === kind);
  }
}

async function bootWorker(): Promise<FakeWorkerScope> {
  const scope = new FakeWorkerScope();
  vi.stubGlobal('self', scope);
  vi.resetModules();
  await import('./sign-session.worker');
  scope.send({ kind: 'openSession', p12: new ArrayBuffer(8), pin: 'the-pin' });
  await flush();
  return scope;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface CapturedVisibleSig {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotate?: 0 | 90 | 180 | 270;
  signerCN?: string;
}

/** El `visibleSig` que recibió la n-ésima llamada a `signPdfPades`. */
function capturedVisibleSig(call = 0): CapturedVisibleSig | undefined {
  const opts = signPdfPadesMock.mock.calls[call]?.[2] as
    | { visibleSig?: CapturedVisibleSig }
    | undefined;
  return opts?.visibleSig;
}

/** Área visible declarada por el fixture (`CropBox ∩ MediaBox`, o el MediaBox). */
function visibleArea(page: FixturePage): { x: number; y: number; w: number; h: number } {
  const media = page.mediaBox ?? [0, 0, 595.28, 841.89];
  const box: PdfBox = page.cropBox ?? media;
  return { x: box[0], y: box[1], w: box[2] - box[0], h: box[3] - box[1] };
}

function expectInsideVisibleArea(rect: CapturedVisibleSig, page: FixturePage): void {
  const vis = visibleArea(page);
  expect(rect.x).toBeGreaterThanOrEqual(vis.x);
  expect(rect.y).toBeGreaterThanOrEqual(vis.y);
  expect(rect.x + rect.width).toBeLessThanOrEqual(vis.x + vis.w);
  expect(rect.y + rect.height).toBeLessThanOrEqual(vis.y + vis.h);
}

const A4: PdfBox = [0, 0, 595.28, 841.89];

/** Los 3 documentos heterogéneos del criterio 2. */
const FLAT_PAGE: FixturePage = { mediaBox: A4 };
const ROTATED_PAGE: FixturePage = { mediaBox: A4, rotate: 90 };
const CROPPED_PAGE: FixturePage = { mediaBox: A4, cropBox: [20, 30, 500, 700] };

function okSignResult(): Record<string, unknown> {
  return {
    signedPdf: new Uint8Array([1, 2, 3]),
    timestamp: { ok: false, reason: 'disabled' },
    ltv: {
      profile: 'B-B',
      longTermAchieved: false,
      archiveAchieved: false,
      embeddedOcspCount: 0,
      embeddedCrlCount: 0,
      warnings: [],
    },
  };
}

beforeEach(() => {
  parsePfxMock.mockReset();
  parsePfxMock.mockResolvedValue({
    signingCert: { subjectCN: 'TEST-LEAF', der: new Uint8Array([1]) },
    intermediates: [],
    privateKeyPkcs8Der: new Uint8Array(64).fill(0xab).buffer,
  });
  signPdfPadesMock.mockReset();
  signPdfPadesMock.mockResolvedValue(okSignResult());
  addIncrementalSignatureMock.mockReset();
  detectSignaturesMock.mockReset();
  detectSignaturesMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('signNext con visibleSigAuto — 3 documentos heterogéneos', () => {
  it('firma los tres y cada rect cae dentro del área visible de SU página, con su rotate', async () => {
    const scope = await bootWorker();
    const docs: FixturePage[] = [FLAT_PAGE, ROTATED_PAGE, CROPPED_PAGE];

    for (const [i, page] of docs.entries()) {
      scope.send({
        kind: 'signNext',
        requestId: `r-${i}`,
        pdf: buildMinimalPdfBuffer([page]),
        visibleSigAuto: true,
      });
      await flush();
    }

    // Los tres se firmaron y ninguno pidió revisión.
    expect(signPdfPadesMock).toHaveBeenCalledTimes(3);
    expect(scope.posted.filter((m) => m.kind === 'signResult')).toHaveLength(3);
    expect(scope.find('signNeedsReview')).toBeUndefined();
    expect(scope.find('signError')).toBeUndefined();

    for (const [i, page] of docs.entries()) {
      const rect = capturedVisibleSig(i);
      expect(rect, `documento ${i}`).toBeDefined();
      expect(rect!.page).toBe(0);
      expect(rect!.rotate).toBe(page.rotate ?? 0);
      expect(rect!.signerCN).toBe('TEST-LEAF');
      expectInsideVisibleArea(rect!, page);
    }

    // Con /Rotate 90 el rect FÍSICO va con las dimensiones intercambiadas
    // (h×w del cuadro "en lectura"), no w×h.
    const flat = capturedVisibleSig(0)!;
    const rotated = capturedVisibleSig(1)!;
    // `toBeCloseTo` y no `toBe`: el rect rotado sale de una ida y vuelta por el
    // espacio canónico, que deja ruido de coma flotante (239.99999999999994).
    expect(flat.width).toBeGreaterThan(flat.height);
    expect(rotated.width).toBeCloseTo(flat.height, 6);
    expect(rotated.height).toBeCloseTo(flat.width, 6);
  });

  it('respeta el /Rect de un campo de firma vacío en vez de recolocarlo', async () => {
    const scope = await bootWorker();
    const fieldRect: PdfBox = [200, 500, 440, 572];
    const page: FixturePage = { mediaBox: A4, widgets: [{ rect: fieldRect }] };

    scope.send({
      kind: 'signNext',
      requestId: 'r-field',
      pdf: buildMinimalPdfBuffer([page]),
      visibleSigAuto: true,
    });
    await flush();

    expect(scope.find('signResult')).toBeDefined();
    expect(capturedVisibleSig()).toMatchObject({
      page: 0,
      x: fieldRect[0],
      y: fieldRect[1],
      width: fieldRect[2] - fieldRect[0],
      height: fieldRect[3] - fieldRect[1],
      rotate: 0,
    });
  });

  it('MediaBox con origen desplazado ⇒ needs_review: no firma y dice por qué', async () => {
    const scope = await bootWorker();
    const shifted: FixturePage = { mediaBox: [400, 0, 995, 842] };

    scope.send({
      kind: 'signNext',
      requestId: 'r-shift',
      pdf: buildMinimalPdfBuffer([shifted]),
      visibleSigAuto: true,
    });
    await flush();

    const review = scope.find('signNeedsReview');
    expect(review).toBeDefined();
    expect(review!['requestId']).toBe('r-shift');
    expect(review!['page']).toBe(0);
    expect(String(review!['reason'])).toContain('out_of_media_box');
    expect(signPdfPadesMock).not.toHaveBeenCalled();
    expect(addIncrementalSignatureMock).not.toHaveBeenCalled();
    expect(scope.find('signResult')).toBeUndefined();
    expect(scope.find('signError')).toBeUndefined();
  });

  it('un PDF ilegible con colocación automática pide revisión en vez de reventar', async () => {
    const scope = await bootWorker();

    scope.send({
      kind: 'signNext',
      requestId: 'r-junk',
      pdf: new TextEncoder().encode('no soy un PDF').slice().buffer as ArrayBuffer,
      visibleSigAuto: true,
    });
    await flush();

    const review = scope.find('signNeedsReview');
    expect(review).toBeDefined();
    expect(String(review!['reason'])).toBe('document_unreadable');
    expect(signPdfPadesMock).not.toHaveBeenCalled();
  });

  it('sin visibleSigAuto no analiza nada: el visibleSig explícito pasa tal cual', async () => {
    const scope = await bootWorker();

    scope.send({
      kind: 'signNext',
      requestId: 'r-manual',
      pdf: buildMinimalPdfBuffer([FLAT_PAGE]),
      opts: { visibleSig: { page: 0, x: 11, y: 22, width: 240, height: 72 } },
    });
    await flush();

    expect(capturedVisibleSig()).toMatchObject({ x: 11, y: 22 });
    expect(scope.find('signNeedsReview')).toBeUndefined();
  });

  it('con rect explícito Y visibleSigAuto, manda el rect: lo puso una persona', async () => {
    const scope = await bootWorker();

    // El bus de sesión hoy hace estas dos cosas mutuamente excluyentes, así que
    // esta petición contradictoria solo se construye a mano. Se fija de todos
    // modos porque la respuesta correcta no es obvia y la contraria sí es
    // peligrosa: un rect explícito significa que alguien MIRÓ este documento y
    // decidió, y ninguna heurística debe pisar eso. Si mañana el bus deja pasar
    // ambos campos, este test dice qué gana en vez de dejarlo al azar del `??`.
    scope.send({
      kind: 'signNext',
      requestId: 'r-ambos',
      pdf: buildMinimalPdfBuffer([FLAT_PAGE]),
      visibleSigAuto: true,
      opts: { visibleSig: { page: 0, x: 33, y: 44, width: 240, height: 72 } },
    });
    await flush();

    expect(capturedVisibleSig()).toMatchObject({ x: 33, y: 44 });
  });
});
