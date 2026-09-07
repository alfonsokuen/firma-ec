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
 *   6. `privateKeyJwk` sale normalizado a su esqueleto público (`kty` a secas).
 *      Hoy `parsePfx` ya lo emite así, pero el rest-spread de `toPublicParsed`
 *      lo REENVIABA tal cual: si alguien reactiva la ruta Web Crypto y el campo
 *      pasa a llevar el JWK completo, la clave vuelve a cruzar. Y cruzaría
 *      invisible, porque los componentes privados de un JWK son STRINGS
 *      base64url y los detectores sólo miraban buffers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JWK_PROP, JWK_PUBLIC_PROPS, KEY_MATERIAL_PROPS } from './key-material-props';

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

/**
 * Recorre el objeto y devuelve las rutas donde asoma material de clave.
 *
 * Dos reglas, la segunda es la que faltaba:
 *   (a) por NOMBRE, contra la lista compartida `KEY_MATERIAL_PROPS` (misma que
 *       usa `sign-session-bus.test.ts`);
 *   (b) por FORMA de `privateKeyJwk` — se admite el esqueleto público y nada
 *       más. Un JWK completo se delata aquí aunque renombraran sus miembros.
 */
function findKeyMaterialPaths(value: unknown, path = '$'): string[] {
  if (value === null || typeof value !== 'object') return [];
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return [];
  const hits: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const here = `${path}.${k}`;
    if (KEY_MATERIAL_PROPS.includes(k)) hits.push(here);
    if (k === JWK_PROP && v !== null && typeof v === 'object') {
      for (const inner of Object.keys(v as Record<string, unknown>)) {
        // La regla de nombre ya cubre los componentes conocidos; aquí sólo
        // lo que NO está en la lista (un miembro nuevo o renombrado).
        if (!JWK_PUBLIC_PROPS.includes(inner) && !KEY_MATERIAL_PROPS.includes(inner))
          hits.push(`${here}.${inner}`);
      }
    }
    hits.push(...findKeyMaterialPaths(v, here));
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

/** Recolecta todos los STRINGS alcanzables desde el payload, con su ruta.
 *
 *  POR QUE existe: una auditoria independiente (2026-08-23) MIDIO el punto
 *  ciego inyectando la clave en cuatro codificaciones distintas. El detector
 *  unitario solo miraba nombres de propiedad y buffers:
 *
 *    | clave transportada como | antes | ahora |
 *    |-------------------------|-------|-------|
 *    | ArrayBuffer / vista     | ROJO  | ROJO  |
 *    | string base64url        | VERDE | ROJO  |
 *    | string base64 estandar  | VERDE | ROJO  |
 *    | string hex              | VERDE | ROJO  |
 *
 *  Las tres filas de string escapaban. Y no es teorico: los componentes
 *  privados de un JWK (`d`, `p`, `q`, ...) son strings base64url, que es
 *  exactamente la forma en que la fuga ya volvio una vez. El E2E cubria
 *  base64url, pero NO corre en CI, asi que la unica red que se ejecuta
 *  siempre era ciega a la forma mas probable del fallo. */
function collectStrings(
  value: unknown,
  path = '$',
  out: Array<{ path: string; text: string }> = [],
) {
  if (typeof value === 'string') {
    out.push({ path, text: value });
    return out;
  }
  if (value === null || typeof value !== 'object') return out;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    collectStrings(v, `${path}.${k}`, out);
  }
  return out;
}

/** El marcador en TODAS las codificaciones con las que alguien podria sacarlo
 *  del worker sin usar un buffer. Se comprueban las 3 fases de alineacion
 *  porque el marcador puede empezar en cualquier offset del original, y base64
 *  agrupa de 3 en 3 bytes: sin las 3 fases, un desplazamiento de 1 byte lo
 *  esconde. */
function markerEncodings(): string[] {
  const bytes = Uint8Array.from(KEY_MARKER);
  const out = new Set<string>();
  out.add(Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''));
  out.add(Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(''));
  out.add(String.fromCharCode(...bytes)); // bytes crudos en un string latin1
  for (let phase = 0; phase < 3; phase++) {
    const padded = new Uint8Array(phase + bytes.length);
    padded.set(bytes, phase);
    const b64 = Buffer.from(padded).toString('base64');
    // Recorta los caracteres que la alineacion contamina en los extremos.
    const core = b64.slice(Math.ceil((phase * 4) / 3), b64.length - 2).replace(/=+$/, '');
    if (core.length >= 6) {
      out.add(core);
      out.add(core.replace(/\+/g, '-').replace(/\//g, '_')); // base64url
    }
  }
  return [...out].filter((x) => x.length >= 6);
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
async function parseOk(
  privateKeyJwk: JsonWebKey = { kty: 'RSA' },
): Promise<{ scope: FakeWorkerScope; pkcs8: ArrayBuffer }> {
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
    privateKeyJwk,
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
    expect(findKeyMaterialPaths(msg)).toEqual([]);
  });

  it('ningún buffer del mensaje contiene los bytes del PKCS#8', async () => {
    const { scope } = await parseOk();
    const { msg } = scope.posted[0] as { msg: unknown };
    const leaked = collectBuffers(msg).filter(containsMarker);
    expect(leaked).toEqual([]);
  });

  it('🔑 ningún STRING del mensaje contiene la clave, en ninguna codificación', async () => {
    // Regresión del punto ciego medido: base64 estándar y hex evadían este
    // detector Y el E2E; base64url lo evadía a él y sólo lo cazaba el E2E, que
    // no corre en CI. Ver el comentario de `markerEncodings`.
    const { scope } = await parseOk();
    const strings = collectStrings(scope.posted[0]?.msg);
    const needles = markerEncodings();
    expect(needles.length).toBeGreaterThan(3);
    const leaks = strings.filter((s) => needles.some((n) => s.text.includes(n)));
    expect(leaks.map((l) => `${l.path} = ${l.text.slice(0, 40)}`)).toEqual([]);
  });

  it('no transfiere ningún Transferable junto al mensaje', async () => {
    const { scope } = await parseOk();
    expect(scope.posted[0]?.transfer).toEqual([]);
  });

  it('pone a cero el PKCS#8 antes de soltarlo al GC', async () => {
    const { pkcs8 } = await parseOk();
    expect(allZero(pkcs8)).toBe(true);
  });

  /**
   * El caso que faltaba. `parsePfx` hoy emite `privateKeyJwk: { kty }` a secas,
   * así que el rest-spread que sólo despojaba `privateKeyPkcs8Der` parecía
   * bastar. Pero `types.ts` documenta el campo como "Private key as JWK
   * (zero-out after importKey)" y su tipo `JsonWebKey` admite `d`/`p`/`q`/…:
   * el día que alguien reactive la ruta Web Crypto, el reenvío tal cual saca la
   * clave al hilo principal. Este test fija el invariante en la COMPUERTA, no
   * en lo que el firmante devuelva hoy.
   */
  it('normaliza `privateKeyJwk` aunque el firmante devuelva el JWK completo', async () => {
    const { scope } = await parseOk({
      kty: 'RSA',
      n: 'modulo-publico',
      e: 'AQAB',
      d: 'ZXN0by1lcy1sYS1jbGF2ZS1wcml2YWRh',
      p: 'cHJpbW8tcA',
      q: 'cHJpbW8tcQ',
      dp: 'ZHA',
      dq: 'ZHE',
      qi: 'cWk',
    });
    const { msg } = scope.posted[0] as { msg: { parsed: { privateKeyJwk: JsonWebKey } } };

    // (a) el detector no ve NADA: ni el nombre de un componente privado, ni un
    //     `privateKeyJwk` con más forma que su `kty`.
    expect(findKeyMaterialPaths(msg)).toEqual([]);
    // (b) y lo que queda es exactamente el esqueleto público.
    expect(Object.keys(msg.parsed.privateKeyJwk)).toEqual(['kty']);
    expect(msg.parsed.privateKeyJwk.kty).toBe('RSA');
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
