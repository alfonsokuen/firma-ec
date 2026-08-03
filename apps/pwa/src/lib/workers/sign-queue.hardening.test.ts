/**
 * Endurecimiento del motor del lote — defectos D2, D5 y D6.
 *
 * D2 · Reabrir la sesión dejaba el worker ANTERIOR vivo con el PKCS#8
 *      descifrado. De los `SESSION_FATAL_CODES` sólo `timeout` y
 *      `session_closed` terminan el worker viejo; con `worker_error`,
 *      `messageerror` y `post_failed` seguía vivo toda la vida de la pestaña, y
 *      el `finally` limpiaba sólo la ÚLTIMA sesión.
 *
 *      ⚠️ El fake de `sign-queue.safety.test.ts` devuelve SIEMPRE la misma
 *      instancia, así que estructuralmente no puede ver la fuga. El de aquí
 *      CUENTA instancias y verifica que las viejas se cierran y se terminan.
 *
 * D5 · (a) No había forma de cancelar un lote. (b) `validateBatch` metía los
 *      NOMBRES de los documentos del usuario dentro del `message` de un `Error`
 *      — justo lo que `batchZip.ts:230-233` prohíbe con argumento explícito.
 *
 * D6 · Un `BatchZipCapacityError` a mitad de lote se registraba como
 *      `deliveryError`, RETENÍA los bytes firmados y el lote seguía: con el ZIP
 *      ya lleno, cada documento restante repetía el fallo y también retenía,
 *      hasta matar la pestaña por memoria.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchLimitError, MAX_BATCH_FILE_SIZE_BYTES, runBatchSign } from './sign-queue';
import { __setSignSessionWorkerFactoryForTests } from './sign-session-bus';
import type { SignSessionWorkerResponse } from './sign-session-bus';

/** Worker falso que se puede matar en caliente, para provocar `worker_error`. */
class FakeSessionWorker extends EventTarget {
  public readonly postedMessages: unknown[] = [];
  public terminated = 0;
  public closeAcked = false;

  postMessage(msg: unknown): void {
    this.postedMessages.push(msg);
    this.dispatchEvent(Object.assign(new Event('posted'), { msg }));
    if ((msg as { kind?: string }).kind === 'closeSession') {
      this.closeAcked = true;
      Promise.resolve().then(() => this.emit({ kind: 'sessionClosed', wiped: true }));
    }
  }

  terminate(): void {
    this.terminated += 1;
  }

  emit(data: SignSessionWorkerResponse): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data }));
  }

  /** El hilo del worker se muere solo (bundle skew, OOM del worker…). */
  crash(message = 'worker boom'): void {
    this.dispatchEvent(Object.assign(new Event('error'), { message }));
  }

  get kinds(): string[] {
    return this.postedMessages.map((m) => (m as { kind: string }).kind);
  }
}

/**
 * Fábrica que crea una instancia NUEVA por sesión y las guarda todas. Sin esto
 * la fuga de D2 es inobservable: con una sola instancia compartida, "el worker
 * viejo sigue vivo" y "el worker nuevo está vivo" son el mismo hecho.
 */
function installCountingFactory(drive: (w: FakeSessionWorker, index: number) => void): {
  workers: FakeSessionWorker[];
} {
  const workers: FakeSessionWorker[] = [];
  __setSignSessionWorkerFactoryForTests(() => {
    const w = new FakeSessionWorker();
    workers.push(w);
    drive(w, workers.length - 1);
    return w as unknown as Worker;
  });
  return { workers };
}

/**
 * Sólo abre la sesión y se muere al primer `signNext`. Deliberadamente NO
 * responde a la firma: si además contestara `signResult`, la respuesta feliz
 * ganaría la carrera de microtareas y el documento saldría firmado, con lo que
 * el camino session-fatal — el que este test persigue — nunca se ejercitaría.
 */
function driveCrashOnFirstSign(w: FakeSessionWorker): void {
  w.addEventListener('posted', (ev: Event) => {
    const msg = (ev as Event & { msg: unknown }).msg as { kind: string };
    if (msg.kind === 'openSession') {
      Promise.resolve().then(() => w.emit({ kind: 'sessionOpened' }));
      return;
    }
    if (msg.kind === 'signNext') Promise.resolve().then(() => w.crash());
  });
}

/** Responde `openSession` y firma todo lo que le llegue. */
function driveHappy(w: FakeSessionWorker): void {
  w.addEventListener('posted', (ev: Event) => {
    const msg = (ev as Event & { msg: unknown }).msg as { kind: string; requestId?: string };
    if (msg.kind === 'openSession') {
      Promise.resolve().then(() => w.emit({ kind: 'sessionOpened' }));
      return;
    }
    if (msg.kind !== 'signNext' || !msg.requestId) return;
    const requestId = msg.requestId;
    Promise.resolve().then(() =>
      w.emit({
        kind: 'signResult',
        requestId,
        signedPdf: new Uint8Array([1, 2, 3, 4]).buffer,
        timestamp: { ok: true, tsaUrl: 'https://freetsa.org/tsr' },
      }),
    );
  });
}

function makeFile(name: string, sizeBytes = 16): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: 'application/pdf' });
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  __setSignSessionWorkerFactoryForTests(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('D2 — reabrir la sesión CIERRA la anterior (no deja la clave descifrada viva)', () => {
  it('tras un worker_error, el worker viejo recibe closeSession y se termina', async () => {
    const { workers } = installCountingFactory((w, index) => {
      // El primer worker se muere justo cuando le llega el primer documento:
      // `worker_error` es session-fatal pero NO termina el hilo por su cuenta.
      if (index === 0) driveCrashOnFirstSign(w);
      else driveHappy(w);
    });

    const files = [makeFile('a.pdf'), makeFile('b.pdf')];
    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
    });

    expect(workers).toHaveLength(2); // hubo reapertura
    const dead = workers[0]!;
    // Lo que importa: al worker muerto se le pidió BORRAR la clave y se le mató.
    expect(dead.closeAcked).toBe(true);
    expect(dead.kinds).toContain('closeSession');
    expect(dead.terminated).toBe(1);

    // Y el lote siguió su curso en la sesión nueva.
    expect(result.items[0]?.error).toMatchObject({ code: 'worker_error' });
    expect(result.items[1]?.status).toBe('done');
  });

  it('ninguna sesión queda sin terminar al acabar el lote', async () => {
    const { workers } = installCountingFactory((w, index) => {
      if (index === 0) driveCrashOnFirstSign(w);
      else driveHappy(w);
    });

    await runBatchSign([makeFile('a.pdf'), makeFile('b.pdf')], new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
    });

    expect(workers.length).toBeGreaterThan(1);
    for (const w of workers) {
      expect(w.terminated).toBe(1);
      expect(w.closeAcked).toBe(true);
    }
  });

  it('un fallo al cerrar la sesión vieja NO impide la reapertura', async () => {
    const { workers } = installCountingFactory((w, index) => {
      if (index !== 0) {
        driveHappy(w);
      } else {
        driveCrashOnFirstSign(w);
        // Worker wedged: nunca contesta al closeSession. El cierre degrada a
        // "terminar de todos modos" y el lote debe continuar igual.
        w.closeAcked = false;
        const original = w.postMessage.bind(w);
        w.postMessage = (msg: unknown): void => {
          if ((msg as { kind?: string }).kind === 'closeSession') {
            w.postedMessages.push(msg);
            return; // sin ack
          }
          original(msg);
        };
      }
    });

    const result = await runBatchSign(
      [makeFile('a.pdf'), makeFile('b.pdf')],
      new ArrayBuffer(8),
      'pin',
      { closeAckTimeoutMs: 30 },
    );

    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminated).toBe(1); // se mata igual
    expect(result.items[1]?.status).toBe('done'); // y el lote siguió
  });
});

describe('D5a — el lote se puede cancelar', () => {
  it('los documentos restantes quedan cancelled, no failed, y el teardown corre', async () => {
    const controller = new AbortController();
    const { workers } = installCountingFactory(driveHappy);

    const files = ['a', 'b', 'c', 'd'].map((n) => makeFile(`${n}.pdf`));
    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
      signal: controller.signal,
      onItemSigned: (item) => {
        if (item.file.name === 'b.pdf') controller.abort();
      },
    });

    expect(result.items.map((i) => i.status)).toEqual(['done', 'done', 'cancelled', 'cancelled']);
    expect(result.cancelled).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.succeeded).toBe(2);
    // Un cancelado no lleva error: no hay nada que arreglar.
    expect(result.items[2]?.error).toBeUndefined();
    // Sólo se firmaron los dos primeros: a los cancelados ni se les leyó el fichero.
    const signNextCount = workers[0]!.kinds.filter((k) => k === 'signNext').length;
    expect(signNextCount).toBe(2);
    // El teardown (wipe + terminate) corrió igual.
    expect(workers[0]?.closeAcked).toBe(true);
    expect(workers[0]?.terminated).toBe(1);
  });

  it('una señal ya abortada cancela el lote entero sin firmar nada', async () => {
    const { workers } = installCountingFactory(driveHappy);
    const controller = new AbortController();
    controller.abort();

    const result = await runBatchSign(
      [makeFile('a.pdf'), makeFile('b.pdf')],
      new ArrayBuffer(8),
      'pin',
      { closeAckTimeoutMs: 50, signal: controller.signal },
    );

    expect(result.cancelled).toBe(2);
    expect(result.succeeded).toBe(0);
    expect(workers[0]!.kinds.filter((k) => k === 'signNext')).toHaveLength(0);
    expect(workers[0]?.terminated).toBe(1);
  });

  it('sin señal el lote se comporta igual que siempre', async () => {
    installCountingFactory(driveHappy);

    const result = await runBatchSign(
      [makeFile('a.pdf'), makeFile('b.pdf')],
      new ArrayBuffer(8),
      'pin',
      { closeAckTimeoutMs: 50 },
    );

    expect(result.succeeded).toBe(2);
    expect(result.cancelled).toBe(0);
  });
});

describe('D5b — los nombres de los documentos no viajan en el message de un Error', () => {
  it('BatchLimitError nombra la causa sin filtrar nombres, y los expone aparte', async () => {
    const files = [
      makeFile('a.pdf'),
      makeFile('CONTRATO CONFIDENCIAL PACIENTE.pdf', MAX_BATCH_FILE_SIZE_BYTES + 1),
    ];

    let thrown: unknown;
    try {
      await runBatchSign(files, new ArrayBuffer(8), 'pin');
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(BatchLimitError);
    const error = thrown as BatchLimitError;
    expect(error.code).toBe('file_too_large');
    // El nombre NO está en el mensaje (que acaba en cualquier manejador global)...
    expect(error.message).not.toContain('CONTRATO');
    expect(error.message).not.toContain('.pdf');
    // ...pero sigue disponible en un campo estructurado, para que la UI señale.
    expect(error.fileNames).toEqual(['CONTRATO CONFIDENCIAL PACIENTE.pdf']);
    // Y el mensaje sigue explicando qué pasó.
    expect(error.message).toContain('1 archivo(s)');
  });
});

describe('D6 — cortacircuitos de entrega: un destino lleno para el lote', () => {
  /** Lo que lanza `BatchZipWriter.addPdf` cuando el ZIP no admite más. */
  function capacityError(): Error {
    return Object.assign(new Error('El ZIP llegaría a ~1025 MB y el tope es 1024 MB.'), {
      name: 'BatchZipCapacityError',
      code: 'zip_total_too_large',
    });
  }

  it('el primer BatchZipCapacityError para el lote en vez de retener N PDFs firmados', async () => {
    const { workers } = installCountingFactory(driveHappy);
    const files = ['a', 'b', 'c', 'd', 'e'].map((n) => makeFile(`${n}.pdf`));

    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
      onItemSigned: (item) => {
        if (item.file.name === 'a.pdf') return Promise.resolve();
        return Promise.reject(capacityError());
      },
    });

    // b.pdf falla la entrega y conserva sus bytes como salvavidas...
    expect(result.items[1]?.status).toBe('done');
    expect(result.items[1]?.deliveryError).toMatchObject({ code: 'zip_total_too_large' });
    expect(result.items[1]?.result?.signedPdf).toBeInstanceOf(Uint8Array);
    // ...y el lote PARA ahí: c/d/e ni se firman, así que no acumulan bytes.
    for (const index of [2, 3, 4]) {
      expect(result.items[index]?.status).toBe('failed');
      expect(result.items[index]?.error).toMatchObject({ code: 'delivery_aborted' });
      expect(result.items[index]?.result).toBeUndefined();
    }
    // Exactamente un PDF firmado retenido en todo el lote, no cuatro.
    expect(result.items.filter((i) => i.result !== undefined)).toHaveLength(1);
    expect(workers[0]!.kinds.filter((k) => k === 'signNext')).toHaveLength(2);
  });

  it('dos fallos de entrega CONSECUTIVOS cualesquiera también paran el lote', async () => {
    installCountingFactory(driveHappy);
    const files = ['a', 'b', 'c', 'd'].map((n) => makeFile(`${n}.pdf`));

    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
      onItemSigned: () =>
        Promise.reject(Object.assign(new Error('disk full'), { name: 'QuotaExceededError' })),
    });

    expect(result.items[0]?.deliveryError).toBeDefined();
    expect(result.items[1]?.deliveryError).toBeDefined();
    expect(result.items[2]?.error).toMatchObject({ code: 'delivery_aborted' });
    expect(result.items[3]?.error).toMatchObject({ code: 'delivery_aborted' });
    // Dos retenidos como mucho: el cortacircuitos acota la fuga.
    expect(result.items.filter((i) => i.result !== undefined)).toHaveLength(2);
  });

  it('un fallo de entrega AISLADO no para nada (la racha se reinicia al primer éxito)', async () => {
    installCountingFactory(driveHappy);
    const files = ['a', 'b', 'c', 'd'].map((n) => makeFile(`${n}.pdf`));

    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
      onItemSigned: (item) =>
        item.file.name === 'b.pdf'
          ? Promise.reject(Object.assign(new Error('hiccup'), { name: 'AbortError' }))
          : Promise.resolve(),
    });

    expect(result.items.map((i) => i.status)).toEqual(['done', 'done', 'done', 'done']);
    expect(result.succeeded).toBe(4);
    expect(result.items.some((i) => i.error?.code === 'delivery_aborted')).toBe(false);
  });

  it('una entrega que falla NUNCA mata la sesión (sigue siendo la fase de entrega)', async () => {
    const { workers } = installCountingFactory(driveHappy);
    const files = ['a', 'b', 'c'].map((n) => makeFile(`${n}.pdf`));

    const result = await runBatchSign(files, new ArrayBuffer(8), 'pin', {
      closeAckTimeoutMs: 50,
      onItemSigned: () => Promise.reject(capacityError()),
    });

    expect(result.items.some((i) => i.error?.code === 'session_aborted')).toBe(false);
    expect(workers).toHaveLength(1); // ninguna reapertura: la sesión estaba sana
  });
});
