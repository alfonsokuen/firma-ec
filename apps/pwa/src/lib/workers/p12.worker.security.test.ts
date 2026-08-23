/**
 * Regresión de seguridad — la clave privada del .p12 NUNCA cruza al hilo principal.
 *
 * Se prueba la RUTA REAL, no un helper: se arranca el módulo `p12.worker.ts`
 * contra un `DedicatedWorkerGlobalScope` falso y se inspecciona el mensaje que
 * el worker realmente emite por `postMessage`. Un test que sólo ejercitara la
 * función de saneado pasaría en verde aunque el worker dejara de llamarla.
 *
 * Invariante bajo prueba (OWASP A02 / ASVS 8.2):
 *   1. El payload `result` no contiene `privateKeyPkcs8Der` en NINGÚN nivel.
 *   2. Ningún ArrayBuffer del payload contiene los bytes del PKCS#8.
 *   3. El buffer original queda a cero antes de soltarse al GC.
 *   4. No se transfiere ningún `Transferable` con el mensaje (transferir la
 *      clave era justamente el vector: la entregaba sin copia al hilo principal).
 *   5. Los campos públicos que la UI sí necesita (CN, emisor, validez) siguen ahí.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const parsePfxMock = vi.fn();

vi.mock('@firma-ec/signer', async () => {
  const actual = await vi.importActual<typeof import('@firma-ec/signer')>('@firma-ec/signer');
  return {
    ...actual,
    parsePfx: (...args: unknown[]) => parsePfxMock(...args),
  };
});

class FakeWorkerScope extends EventTarget {
  public readonly posted: { msg: unknown; transfer: Transferable[] }[] = [];

  postMessage(msg: unknown, transfer?: Transferable[]): void {
    this.posted.push({ msg, transfer: transfer ?? [] });
  }

  send(data: unknown): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data }));
  }
}

async function bootWorker(): Promise<FakeWorkerScope> {
  const scope = new FakeWorkerScope();
  vi.stubGlobal('self', scope);
  vi.resetModules();
  await import('./p12.worker');
  return scope;
}

/** Deja correr las microtareas del handler `async` del worker. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Patrón reconocible: si estos bytes aparecen en el payload, la clave cruzó. */
const KEY_MARKER = [0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe];

function makePkcs8(): ArrayBuffer {
  const buf = new ArrayBuffer(64);
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i++) u[i] = KEY_MARKER[i % KEY_MARKER.length] as number;
  return buf;
}

/** Recorre el objeto y devuelve las rutas donde aparece la propiedad buscada. */
function findKeyPaths(value: unknown, needle: string, path = '$'): string[] {
  if (value === null || typeof value !== 'object') return [];
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return [];
  const hits: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const here = `${path}.${k}`;
    if (k === needle) hits.push(here);
    hits.push(...findKeyPaths(v, needle, here));
  }
  return hits;
}

/** Recolecta todos los buffers alcanzables desde el payload. */
function collectBuffers(value: unknown, out: Uint8Array[] = []): Uint8Array[] {
  if (value === null || typeof value !== 'object') return out;
  if (value instanceof ArrayBuffer) {
    out.push(new Uint8Array(value));
    return out;
  }
  if (ArrayBuffer.isView(value)) {
    const v = value as ArrayBufferView;
    out.push(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    return out;
  }
  for (const v of Object.values(value as Record<string, unknown>)) collectBuffers(v, out);
  return out;
}

function containsMarker(bytes: Uint8Array): boolean {
  outer: for (let i = 0; i + KEY_MARKER.length <= bytes.length; i++) {
    for (let j = 0; j < KEY_MARKER.length; j++) {
      if (bytes[i + j] !== KEY_MARKER[j]) continue outer;
    }
    return true;
  }
  return false;
}

function allZero(buf: ArrayBuffer): boolean {
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i++) if (u[i] !== 0) return false;
  return true;
}

beforeEach(() => {
  parsePfxMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Arranca el worker, le manda un parseo válido y devuelve scope + buffer origen. */
async function parseOk(): Promise<{ scope: FakeWorkerScope; pkcs8: ArrayBuffer }> {
  const pkcs8 = makePkcs8();
  parsePfxMock.mockResolvedValue({
    signingCert: {
      subjectCN: 'TITULAR DE PRUEBA',
      issuerCN: 'CA DE PRUEBA',
      notBefore: new Date('2020-01-01T00:00:00Z'),
      notAfter: new Date('2099-01-01T00:00:00Z'),
      der: new Uint8Array([0x30, 0x82]),
    },
    intermediates: [],
    privateKeyJwk: { kty: 'RSA' },
    sigAlg: 'RSASSA-PKCS1-v1_5-SHA256',
    privateKeyPkcs8Der: pkcs8,
  });
  const scope = await bootWorker();
  scope.send({ kind: 'parsePfx', pfxBytes: new ArrayBuffer(8), pin: 'test1234' });
  await flush();
  return { scope, pkcs8 };
}

describe('p12.worker — la clave privada no cruza al hilo principal', () => {
  it('el mensaje `result` no lleva `privateKeyPkcs8Der` en ningún nivel', async () => {
    const { scope } = await parseOk();
    expect(scope.posted).toHaveLength(1);
    const { msg } = scope.posted[0] as { msg: { kind: string } };
    expect(msg.kind).toBe('result');
    expect(findKeyPaths(msg, 'privateKeyPkcs8Der')).toEqual([]);
  });

  it('ningún buffer del mensaje contiene los bytes del PKCS#8', async () => {
    const { scope } = await parseOk();
    const { msg } = scope.posted[0] as { msg: unknown };
    const leaked = collectBuffers(msg).filter(containsMarker);
    expect(leaked).toEqual([]);
  });

  it('no transfiere ningún Transferable junto al mensaje', async () => {
    const { scope } = await parseOk();
    expect(scope.posted[0]?.transfer).toEqual([]);
  });

  it('pone a cero el PKCS#8 antes de soltarlo al GC', async () => {
    const { pkcs8 } = await parseOk();
    expect(allZero(pkcs8)).toBe(true);
  });

  it('conserva los campos públicos que la UI necesita (CN, emisor, validez)', async () => {
    const { scope } = await parseOk();
    const { msg } = scope.posted[0] as {
      msg: { parsed: { signingCert: { subjectCN: string; issuerCN: string; notAfter: Date } } };
    };
    expect(msg.parsed.signingCert.subjectCN).toBe('TITULAR DE PRUEBA');
    expect(msg.parsed.signingCert.issuerCN).toBe('CA DE PRUEBA');
    expect(msg.parsed.signingCert.notAfter).toBeInstanceOf(Date);
  });
});
