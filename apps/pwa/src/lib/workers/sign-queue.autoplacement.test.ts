/**
 * `visibleSig: 'auto'` en el LOTE (hueco #2, lado cola).
 *
 * Lo que se fija:
 *   - `'auto'` no viaja dentro de `opts` (ese tipo lo comparte el worker de un
 *     solo documento): se traduce al flag `visibleSigAuto` de la petición de
 *     sesión, y el rect explícito no se manda.
 *   - un documento que pide revisión NO se firma, NO cuenta como `failed` ni
 *     como `succeeded`, el lote CONTINÚA con los demás, y el motivo llega al
 *     llamante (por `onItemUpdate` y en el ítem del resultado).
 *   - un rect explícito sigue viajando igual que antes (no hay regresión).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BatchQueueItem, runBatchSign } from './sign-queue';
import {
  type SignNextRequest,
  type SignSessionWorkerResponse,
  VISIBLE_SIG_AUTO,
  __setSignSessionWorkerFactoryForTests,
} from './sign-session-bus';

class FakeSessionWorker extends EventTarget {
  public readonly postedMessages: unknown[] = [];
  public terminated = 0;

  postMessage(msg: unknown): void {
    this.postedMessages.push(msg);
    this.dispatchEvent(Object.assign(new Event('posted'), { msg }));
  }

  terminate(): void {
    this.terminated += 1;
  }

  emit(data: SignSessionWorkerResponse): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data }));
  }

  signNextRequests(): SignNextRequest[] {
    return this.postedMessages.filter(
      (m): m is SignNextRequest => (m as { kind?: string }).kind === 'signNext',
    );
  }
}

/**
 * Responde cada `signNext` según el ORDEN de llegada (la cola es de
 * concurrencia 1, así que el n-ésimo `signNext` es el n-ésimo documento).
 */
function installFake(
  answerFor: (index: number) => { kind: 'ok' } | { kind: 'needs_review'; reason: string },
): FakeSessionWorker {
  const w = new FakeSessionWorker();
  let index = 0;
  w.addEventListener('posted', (ev: Event) => {
    const msg = (ev as Event & { msg: unknown }).msg as { kind: string; requestId?: string };
    if (msg.kind === 'openSession') {
      void Promise.resolve().then(() => w.emit({ kind: 'sessionOpened' }));
      return;
    }
    if (msg.kind === 'closeSession') {
      void Promise.resolve().then(() => w.emit({ kind: 'sessionClosed', wiped: true }));
      return;
    }
    if (msg.kind !== 'signNext') return;
    const requestId = msg.requestId as string;
    const answer = answerFor(index);
    index += 1;
    void Promise.resolve().then(() => {
      if (answer.kind === 'needs_review') {
        w.emit({ kind: 'signNeedsReview', requestId, page: 0, reason: answer.reason });
        return;
      }
      w.emit({
        kind: 'signResult',
        requestId,
        signedPdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
        timestamp: { ok: false, reason: 'user_disabled' },
        ltv: {
          profile: 'B-B',
          longTermAchieved: false,
          archiveAchieved: false,
          embeddedOcspCount: 0,
          embeddedCrlCount: 0,
          warnings: [],
        },
      });
    });
  });
  __setSignSessionWorkerFactoryForTests(() => w as unknown as Worker);
  return w;
}

function makeFile(name: string, sizeBytes = 16): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: 'application/pdf' });
}

/** Opciones comunes: sin red (TSA/LTV apagados) para que un ítem = un signNext. */
const NO_NETWORK = { timestampEnabled: false, ltvEnabled: false } as const;

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  __setSignSessionWorkerFactoryForTests(null);
  vi.useRealTimers();
});

describe("runBatchSign con visibleSig: 'auto'", () => {
  it('pide colocación automática por documento vía visibleSigAuto, no dentro de opts', async () => {
    const w = installFake(() => ({ kind: 'ok' }));

    const res = await runBatchSign(
      [makeFile('a.pdf'), makeFile('b.pdf')],
      new ArrayBuffer(8),
      'pin1234',
      { ...NO_NETWORK, visibleSig: VISIBLE_SIG_AUTO },
    );

    expect(res.succeeded).toBe(2);
    expect(res.needsReview).toBe(0);
    const reqs = w.signNextRequests();
    expect(reqs).toHaveLength(2);
    for (const req of reqs) {
      expect(req.visibleSigAuto).toBe(true);
      expect(req.opts?.visibleSig).toBeUndefined();
    }
  });

  it('un rect explícito sigue viajando dentro de opts, sin flag de auto', async () => {
    const w = installFake(() => ({ kind: 'ok' }));

    await runBatchSign([makeFile('a.pdf')], new ArrayBuffer(8), 'pin1234', {
      ...NO_NETWORK,
      visibleSig: { page: 0, x: 10, y: 20, width: 240, height: 72 },
    });

    const [req] = w.signNextRequests();
    expect(req!.visibleSigAuto).toBeUndefined();
    expect(req!.opts?.visibleSig).toMatchObject({ x: 10, y: 20 });
  });

  it('un documento que necesita revisión no se firma, no es fallo, y el lote continúa', async () => {
    const REASON = 'default_footer_rect_out_of_media_box';
    const w = installFake((i) =>
      i === 1 ? { kind: 'needs_review', reason: REASON } : { kind: 'ok' },
    );
    const updates: BatchQueueItem[] = [];

    const res = await runBatchSign(
      [makeFile('a.pdf'), makeFile('raro.pdf'), makeFile('c.pdf')],
      new ArrayBuffer(8),
      'pin1234',
      {
        ...NO_NETWORK,
        visibleSig: VISIBLE_SIG_AUTO,
        onItemUpdate: (item) => updates.push({ ...item }),
      },
    );

    // El lote llegó hasta el final: los 3 documentos se intentaron.
    expect(w.signNextRequests()).toHaveLength(3);
    expect(res.succeeded).toBe(2);
    expect(res.failed).toBe(0);
    expect(res.needsReview).toBe(1);
    expect(res.succeeded + res.failed + res.needsReview).toBe(3);

    const apartado = res.items[1]!;
    expect(apartado.status).toBe('needs_review');
    expect(apartado.needsReview).toEqual({ page: 0, reason: REASON });
    // Ni PDF firmado ni error: el documento quedó intacto esperando a un humano.
    expect(apartado.result).toBeUndefined();
    expect(apartado.error).toBeUndefined();
    // Y el motivo también llegó en vivo, no solo en el resumen final.
    expect(
      updates.some((u) => u.status === 'needs_review' && u.needsReview?.reason === REASON),
    ).toBe(true);
    // El documento siguiente SÍ se firmó (el lote no se abandonó).
    expect(res.items[2]!.status).toBe('done');
  });
});
