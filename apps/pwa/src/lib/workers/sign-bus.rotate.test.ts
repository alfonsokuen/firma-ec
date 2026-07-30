/**
 * El cable tipado tiene que poder pedir la apariencia ROTADA.
 *
 * `SignVisibleSigInput` (el tipo que viaja por `postMessage`) declaraba
 * page/x/y/width/height/fontSize pero NO `rotate`, mientras que
 * `VisibleSigInput` del firmante sí — el worker lo propagaba por spread, así
 * que en runtime "funcionaba", pero el camino TIPADO no podía expresar lo que
 * necesitan justo las páginas con `/Rotate`: la colocación automática de un
 * lote calcula el `rotate` de la página y no tenía forma legítima de mandarlo.
 *
 * El rojo de este hueco es de compilación (`tsc --noEmit`), no de runtime:
 * esbuild borra los tipos, así que la aserción de propagación pasa igual. Por
 * eso hay DOS aserciones: la de tipos (`expectTypeOf`, que solo puede fallar en
 * tsc) y la de runtime (que fija que el valor de verdad cruza el bus).
 */

import type { VisibleSigInput } from '@firma-ec/signer';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  type SignRequest,
  type SignVisibleSigInput,
  type SignWorkerResponse,
  __setSignWorkerFactoryForTests,
  runSign,
} from './sign-bus';

class FakeWorker extends EventTarget {
  public readonly postedMessages: unknown[] = [];
  public terminated = 0;

  postMessage(msg: unknown): void {
    this.postedMessages.push(msg);
  }

  terminate(): void {
    this.terminated += 1;
  }

  emit(data: SignWorkerResponse): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data }));
  }
}

function installFake(): FakeWorker {
  const w = new FakeWorker();
  __setSignWorkerFactoryForTests(() => w as unknown as Worker);
  return w;
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  __setSignWorkerFactoryForTests(null);
  vi.useRealTimers();
});

describe('SignVisibleSigInput.rotate', () => {
  it('declara el MISMO dominio de rotación que VisibleSigInput del firmante', () => {
    expectTypeOf<SignVisibleSigInput['rotate']>().toEqualTypeOf<VisibleSigInput['rotate']>();
  });

  it('viaja por el bus hasta la petición del worker', async () => {
    const w = installFake();
    const visibleSig: SignVisibleSigInput = {
      page: 0,
      x: 100,
      y: 40,
      width: 240,
      height: 72,
      rotate: 90,
    };

    const promise = runSign(new ArrayBuffer(8), new ArrayBuffer(4), 'pin1234', { visibleSig });

    await Promise.resolve();
    w.emit({
      kind: 'result',
      signedPdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
      timestamp: { ok: false, reason: 'disabled' },
    });
    await promise;

    const req = w.postedMessages[0] as SignRequest;
    expect(req.opts?.visibleSig?.rotate).toBe(90);
  });
});
