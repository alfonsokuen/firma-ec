/**
 * Integración real de `batchZip` con `runBatchSign` por `onItemSigned`.
 *
 * Lo que se fija aquí:
 *   - el tope del ZIP se comprueba ANTES de abrir la sesión de firma: un lote
 *     que no cabe no consume ni un PKCS#7 (ni un PIN, ni una llamada a la TSA);
 *   - la tubería no acumula: en cualquier instante hay como mucho UN PDF firmado
 *     vivo en el heap, con 4 documentos y con 40;
 *   - lo que queda FUERA del ZIP (`needs_review`, fallidos, entrega fallida) se
 *     le dice al llamante, con su motivo;
 *   - el ZIP resultante lo abre una herramienta ajena.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type SignSessionWorkerResponse,
  __setSignSessionWorkerFactoryForTests,
} from '../workers/sign-session-bus';
import { BatchZipCapacityError, BatchZipWriter, signBatchToZip } from './batchZip';
import { extractWithForeignTool } from './foreignZipExtract.fixture';

type Answer =
  | { kind: 'ok'; bytes: Uint8Array }
  | { kind: 'needs_review'; reason: string }
  | { kind: 'error'; code: string; message: string };

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

  signNextCount(): number {
    return this.postedMessages.filter((m) => (m as { kind?: string }).kind === 'signNext').length;
  }
}

/** Responde cada `signNext` por orden de llegada (la cola es de concurrencia 1). */
function installFake(answerFor: (index: number) => Answer): FakeSessionWorker {
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
      if (answer.kind === 'error') {
        w.emit({ kind: 'signError', requestId, code: answer.code, message: answer.message });
        return;
      }
      w.emit({
        kind: 'signResult',
        requestId,
        signedPdf: answer.bytes.slice().buffer,
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

function signedBytes(seed: number, length = 2048): Uint8Array {
  const out = new Uint8Array(length);
  out.set([0x25, 0x50, 0x44, 0x46], 0); // %PDF
  let x = seed | 1;
  for (let i = 4; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (x >>> 16) & 0xff;
  }
  return out;
}

/** Sin red: un documento = un `signNext`, sin reintentos de TSA de por medio. */
const NO_NETWORK = { timestampEnabled: false, ltvEnabled: false, closeAckTimeoutMs: 50 } as const;

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  __setSignSessionWorkerFactoryForTests(null);
  vi.useRealTimers();
});

describe('signBatchToZip', () => {
  it('mete los firmados en el ZIP y lo abre una herramienta ajena', async () => {
    const payloads = [signedBytes(3), signedBytes(5), signedBytes(7)];
    installFake((i) => ({ kind: 'ok', bytes: payloads[i] ?? signedBytes(99) }));

    const res = await signBatchToZip(
      [makeFile('contrato.pdf'), makeFile('acta.pdf'), makeFile('contrato.pdf')],
      new ArrayBuffer(8),
      'pin1234',
      NO_NETWORK,
    );

    expect(res.batch.succeeded).toBe(3);
    expect(res.excluded).toEqual([]);
    expect(res.entries.map((e) => e.name)).toEqual([
      'contrato-firmado.pdf',
      'acta-firmado.pdf',
      'contrato-firmado (2).pdf',
    ]);

    const extracted = await extractWithForeignTool(res.zip);
    expect(extracted.get('contrato-firmado.pdf')).toEqual(payloads[0]);
    expect(extracted.get('acta-firmado.pdf')).toEqual(payloads[1]);
    expect(extracted.get('contrato-firmado (2).pdf')).toEqual(payloads[2]);
  });

  it('deja FUERA los needs_review y los fallidos, y dice cuáles y por qué', async () => {
    installFake((i) => {
      if (i === 1) return { kind: 'needs_review', reason: 'no_defensible_rect' };
      if (i === 2) return { kind: 'error', code: 'encrypted_pdf', message: 'PDF cifrado' };
      return { kind: 'ok', bytes: signedBytes(i + 1) };
    });

    const res = await signBatchToZip(
      [makeFile('ok.pdf'), makeFile('revisar.pdf'), makeFile('roto.pdf'), makeFile('ok2.pdf')],
      new ArrayBuffer(8),
      'pin1234',
      NO_NETWORK,
    );

    expect(res.entries.map((e) => e.name)).toEqual(['ok-firmado.pdf', 'ok2-firmado.pdf']);
    expect(res.excluded).toEqual([
      expect.objectContaining({ originalName: 'revisar.pdf', reason: 'needs_review' }),
      expect.objectContaining({ originalName: 'roto.pdf', reason: 'failed' }),
    ]);
    expect(res.excluded[0]?.detail).toBe('no_defensible_rect');
    expect(res.excluded[1]?.detail).toBe('encrypted_pdf');

    const extracted = await extractWithForeignTool(res.zip);
    expect([...extracted.keys()].sort()).toEqual(['ok-firmado.pdf', 'ok2-firmado.pdf']);
  });

  it('rechaza el lote que no cabe SIN firmar nada', async () => {
    const w = installFake(() => ({ kind: 'ok', bytes: signedBytes(1) }));
    const files = Array.from({ length: 60 }, (_, i) => makeFile(`d${i}.pdf`, 30 * 1024 * 1024));

    await expect(
      signBatchToZip(files, new ArrayBuffer(8), 'pin1234', NO_NETWORK),
    ).rejects.toBeInstanceOf(BatchZipCapacityError);

    expect(w.signNextCount()).toBe(0);
    expect(w.postedMessages).toEqual([]);
  });
});

describe('la tubería no acumula PDFs firmados', () => {
  /**
   * Sumidero falso: cuenta cuántos PDFs firmados COMPLETOS están vivos a la vez
   * — se registra uno al entrar en `onItemSigned` y se da de baja cuando el
   * escritor ya lo absorbió. El máximo tiene que ser 1 y no moverse con el
   * tamaño del lote; si alguien "optimizara" la cola juntando los documentos
   * para comprimir al final, este número crecería con N.
   */
  async function measurePeak(count: number): Promise<{
    peakLivePdfs: number;
    heapArrayBytes: number;
    maxHeapArrayBytes: number;
  }> {
    installFake((i) => ({ kind: 'ok', bytes: signedBytes(i + 1, 4096) }));
    const writer = new BatchZipWriter();
    let live = 0;
    let peakLivePdfs = 0;
    const { runBatchSign } = await import('../workers/sign-queue');

    await runBatchSign(
      Array.from({ length: count }, (_, i) => makeFile(`doc-${i}.pdf`)),
      new ArrayBuffer(8),
      'pin1234',
      {
        ...NO_NETWORK,
        onItemSigned: async (item) => {
          live += 1;
          peakLivePdfs = Math.max(peakLivePdfs, live);
          // Latencia real de escritura: si la cola no respetara el backpressure,
          // el siguiente documento entraría aquí antes de que este saliera.
          await new Promise((r) => setTimeout(r, 0));
          writer.addPdf(item.file.name, item.result.signedPdf);
          live -= 1;
        },
      },
    );

    const shape = writer.__debugBufferShapeForTests();
    expect(writer.entries).toHaveLength(count);
    return {
      peakLivePdfs,
      heapArrayBytes: shape.heapArrayBytes,
      maxHeapArrayBytes: shape.maxHeapArrayBytes,
    };
  }

  /** Cota del pico transitorio: cabeceras (decenas de bytes), nunca payload. */
  const MAX_TRANSIENT_HEAP_BYTES = 256;
  /** Lo único que varía entre lotes: la longitud del nombre en la cabecera. */
  const MAX_HEAP_DELTA_FROM_NAME_LENGTH_BYTES = 16;

  it('el máximo de PDFs vivos a la vez es 1 y no crece con el tamaño del lote', async () => {
    const small = await measurePeak(4);
    __setSignSessionWorkerFactoryForTests(null);
    const big = await measurePeak(40);

    expect(small.peakLivePdfs).toBe(1);
    expect(big.peakLivePdfs).toBe(1);
    // Y el escritor tampoco los retiene: ni un byte de payload en el heap.
    expect(small.heapArrayBytes).toBe(0);
    expect(big.heapArrayBytes).toBe(0);
    // Sin igualdad exacta: la cabecera local del ZIP incluye el NOMBRE, así que
    // un lote de 40 nombra ficheros de dos dígitos y pesa unos bytes más que uno
    // de 4. Lo que probaría acumulación es un pico del orden del payload.
    expect(big.maxHeapArrayBytes).toBeLessThan(MAX_TRANSIENT_HEAP_BYTES);
    expect(big.maxHeapArrayBytes - small.maxHeapArrayBytes).toBeLessThan(
      MAX_HEAP_DELTA_FROM_NAME_LENGTH_BYTES,
    );
  });
});
