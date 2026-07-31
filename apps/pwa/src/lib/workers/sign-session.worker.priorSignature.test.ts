/**
 * A2 (lado worker) — el cruce que hoy no hacía nadie.
 *
 * `detectSignatures` y `analyzePdfForPlacement` miran el documento por caminos
 * distintos. Cuando el primero ve firmas previas y el segundo devuelve
 * `existing` vacío, el análisis se ha perdido algo: los productores que separan
 * campo y widget ponen `/V` en el `/Parent`, y hasta el arreglo de
 * `analyzePdf.ts` eso convertía una firma YA PUESTA en "campo de firma vacío".
 * Como la rama `empty-field` tiene prioridad sobre todo lo demás, la estampa
 * caía con el rect EXACTO de la firma anterior — encima — y el lote lo contaba
 * como éxito limpio.
 *
 * El arreglo del análisis cierra ese caso concreto; esta guarda cierra la
 * CLASE: ante esa contradicción no se confía en `empty-field` y el documento se
 * aparta. Se limita a `empty-field` a propósito — una firma previa INVISIBLE
 * (`/Rect [0 0 0 0]`, la forma canónica del §12.7.4.5) también da `existing`
 * vacío legítimamente, y ahí el pie de página es la respuesta correcta.
 *
 * Ningún test preexistente se modifica: este fichero es nuevo.
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

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

/** Una firma previa tal como la reporta `detectSignatures` (solo se mira que haya alguna). */
function priorSignature(): Record<string, unknown> {
  return { fieldName: 'Signature1', subFilter: 'ETSI.CAdES.detached', byteRange: [0, 1, 2, 3] };
}

const A4: PdfBox = [0, 0, 595.28, 841.89];

/** Página con un campo de firma declarado SIN `/V` en el propio widget. */
const PAGE_WITH_EMPTY_FIELD: FixturePage = {
  mediaBox: A4,
  widgets: [{ rect: [40, 50, 200, 110] }],
};

/** Página lisa, sin ningún widget de firma. */
const PLAIN_PAGE: FixturePage = { mediaBox: A4 };

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
  addIncrementalSignatureMock.mockResolvedValue(new Uint8Array([4, 5, 6]));
  detectSignaturesMock.mockReset();
  detectSignaturesMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('A2 — firmas previas vistas por detectSignatures pero no por el análisis', () => {
  it('con `empty-field` como fuente y firmas previas invisibles al análisis: se APARTA', async () => {
    const scope = await bootWorker();
    detectSignaturesMock.mockResolvedValue([priorSignature()]);

    scope.send({
      kind: 'signNext',
      requestId: 'r1',
      pdf: buildMinimalPdfBuffer([PAGE_WITH_EMPTY_FIELD]),
      visibleSigAuto: true,
    });
    await flush();

    const review = scope.find('signNeedsReview');
    expect(review).toBeDefined();
    expect(review!['reason']).toBe('empty_field_conflicts_with_prior_signature');
    // Y sobre todo: NO se firmó nada.
    expect(signPdfPadesMock).not.toHaveBeenCalled();
    expect(addIncrementalSignatureMock).not.toHaveBeenCalled();
  });

  it('sin firmas previas, el campo de firma vacío se sigue respetando', async () => {
    const scope = await bootWorker();
    detectSignaturesMock.mockResolvedValue([]);

    scope.send({
      kind: 'signNext',
      requestId: 'r2',
      pdf: buildMinimalPdfBuffer([PAGE_WITH_EMPTY_FIELD]),
      visibleSigAuto: true,
    });
    await flush();

    expect(scope.find('signNeedsReview')).toBeUndefined();
    const opts = signPdfPadesMock.mock.calls[0]?.[2] as
      | { visibleSig?: { x: number; y: number } }
      | undefined;
    expect(opts?.visibleSig).toMatchObject({ x: 40, y: 50 });
  });

  it('firma previa INVISIBLE sin campo declarado: no se aparta, cae al pie de página', async () => {
    const scope = await bootWorker();
    detectSignaturesMock.mockResolvedValue([priorSignature()]);

    scope.send({
      kind: 'signNext',
      requestId: 'r3',
      pdf: buildMinimalPdfBuffer([PLAIN_PAGE]),
      visibleSigAuto: true,
    });
    await flush();

    expect(scope.find('signNeedsReview')).toBeUndefined();
    // Documento ya firmado ⇒ ruta incremental.
    expect(addIncrementalSignatureMock).toHaveBeenCalledTimes(1);
  });
});

describe('A6 — el PDF cifrado se aparta con motivo propio, no revienta como error opaco', () => {
  it('needs_review con reason `document_encrypted`', async () => {
    const scope = await bootWorker();

    const clean = new Uint8Array(buildMinimalPdfBuffer([PLAIN_PAGE]));
    const patched = Buffer.from(clean)
      .toString('latin1')
      .replace(
        'trailer\n<<',
        'trailer\n<< /Encrypt << /Filter /Standard /V 1 /R 2 /O <0102> /U <0304> /P -1 >>',
      );
    const encrypted = new Uint8Array(Buffer.from(patched, 'latin1'));

    scope.send({
      kind: 'signNext',
      requestId: 'r4',
      pdf: encrypted.slice().buffer,
      visibleSigAuto: true,
    });
    await flush();

    const review = scope.find('signNeedsReview');
    expect(review).toBeDefined();
    expect(review!['reason']).toBe('document_encrypted');
    expect(scope.find('signError')).toBeUndefined();
    expect(signPdfPadesMock).not.toHaveBeenCalled();
  });
});
