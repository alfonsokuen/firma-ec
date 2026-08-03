/**
 * Colocación POR DOCUMENTO dentro de un lote.
 *
 * El motivo de existir: `visibleSig` es una opción del LOTE ENTERO, así que
 * «estos 47 en automático, estos 3 con el rect que una persona confirmó» era
 * inexpresable. Sin ese canal la vista previa no puede existir — se puede
 * pintar, pero su resultado no tiene por dónde llegar al firmante.
 *
 * Lo que se fija aquí es el CANAL, no dónde acaba la tinta: con el worker
 * falseado se comprueba qué petición sale para cada documento. Que el rect
 * enviado sea el sitio correcto del papel es harina de otro costal (el oráculo
 * de píxeles), y confundir las dos cosas es justo cómo nacen los verdes falsos.
 *
 * Privacidad: los nombres de fichero de estas pruebas son inventados. El nombre
 * de un documento real es dato del usuario y no se usa como clave de nada.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runBatchSign } from './sign-queue';
import {
  type SignNextRequest,
  type SignSessionWorkerResponse,
  VISIBLE_SIG_AUTO,
  __setSignSessionWorkerFactoryForTests,
} from './sign-session-bus';

class FakeSessionWorker extends EventTarget {
  public readonly postedMessages: unknown[] = [];

  postMessage(msg: unknown): void {
    this.postedMessages.push(msg);
    this.dispatchEvent(Object.assign(new Event('posted'), { msg }));
  }

  terminate(): void {
    /* la cola cierra la sesión al terminar; aquí no hay nada que liberar */
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

/** Worker falso que firma todo lo que le llega, para mirar SOLO qué se le pidió. */
function installFake(): FakeSessionWorker {
  const w = new FakeSessionWorker();
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
    void Promise.resolve().then(() => {
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

function makeFile(name: string): File {
  return new File([new Uint8Array(16)], name, { type: 'application/pdf' });
}

/** Sin red (TSA/LTV apagados): un documento = un `signNext`, sin reintentos. */
const NO_NETWORK = { timestampEnabled: false, ltvEnabled: false } as const;

/** El rect que una persona confirmó en la vista previa de UN documento. */
const RECT_CONFIRMADO = { page: 1, x: 64, y: 96, width: 220, height: 66 } as const;

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  __setSignSessionWorkerFactoryForTests(null);
  vi.useRealTimers();
});

describe('runBatchSign — rect por documento junto a colocación automática', () => {
  it('manda el rect confirmado solo en SU documento y deja los demás en automático', async () => {
    const w = installFake();

    const res = await runBatchSign(
      [makeFile('uno.pdf'), makeFile('dos.pdf'), makeFile('tres.pdf'), makeFile('cuatro.pdf')],
      new ArrayBuffer(8),
      'pin1234',
      {
        ...NO_NETWORK,
        visibleSig: VISIBLE_SIG_AUTO,
        visibleSigByIndex: new Map([[2, RECT_CONFIRMADO]]),
      },
    );

    expect(res.succeeded).toBe(4);
    const reqs = w.signNextRequests();
    expect(reqs).toHaveLength(4);

    // Los tres que nadie tocó siguen pidiendo que el worker decida.
    for (const i of [0, 1, 3]) {
      expect(reqs[i]!.visibleSigAuto).toBe(true);
      expect(reqs[i]!.opts?.visibleSig).toBeUndefined();
    }

    // El tercero lleva el rect de la persona, y NO pide análisis: pedir las dos
    // cosas a la vez deja al worker eligiendo cuál gana, que es una decisión que
    // no le toca.
    expect(reqs[2]!.visibleSigAuto).toBeUndefined();
    expect(reqs[2]!.opts?.visibleSig).toEqual(RECT_CONFIRMADO);
  });

  it('el rect por documento gana también cuando el lote lleva un rect fijo', async () => {
    const w = installFake();
    const RECT_DEL_LOTE = { page: 0, x: 10, y: 20, width: 240, height: 72 } as const;

    await runBatchSign([makeFile('uno.pdf'), makeFile('dos.pdf')], new ArrayBuffer(8), 'pin1234', {
      ...NO_NETWORK,
      visibleSig: RECT_DEL_LOTE,
      visibleSigByIndex: new Map([[1, RECT_CONFIRMADO]]),
    });

    const reqs = w.signNextRequests();
    expect(reqs[0]!.opts?.visibleSig).toEqual(RECT_DEL_LOTE);
    expect(reqs[1]!.opts?.visibleSig).toEqual(RECT_CONFIRMADO);
  });

  it('sin overrides no cambia nada: el lote entero sigue en automático', async () => {
    const w = installFake();

    await runBatchSign([makeFile('uno.pdf'), makeFile('dos.pdf')], new ArrayBuffer(8), 'pin1234', {
      ...NO_NETWORK,
      visibleSig: VISIBLE_SIG_AUTO,
    });

    for (const req of w.signNextRequests()) {
      expect(req.visibleSigAuto).toBe(true);
      expect(req.opts?.visibleSig).toBeUndefined();
    }
  });

  it('un índice fuera de rango no desplaza el rect a otro documento', async () => {
    const w = installFake();

    await runBatchSign([makeFile('uno.pdf'), makeFile('dos.pdf')], new ArrayBuffer(8), 'pin1234', {
      ...NO_NETWORK,
      visibleSig: VISIBLE_SIG_AUTO,
      // 7 no existe en un lote de 2. El fallo que esto veta es el peor de todos:
      // estampar en un documento el sitio que se confirmó para OTRO.
      visibleSigByIndex: new Map([[7, RECT_CONFIRMADO]]),
    });

    for (const req of w.signNextRequests()) {
      expect(req.visibleSigAuto).toBe(true);
      expect(req.opts?.visibleSig).toBeUndefined();
    }
  });
});
