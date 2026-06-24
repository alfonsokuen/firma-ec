import { describe, expect, it, vi } from 'vitest';
import {
  type NaturalPersonFiles,
  type NaturalPersonKyc,
  UanatacaError,
  UanatacaHttpClient,
  mapNaturalPersonToCreateInput,
} from '../src/index.js';

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function authRes(): Response {
  return jsonRes({ access_token: 'tok', token_type: 'Bearer', expires_in: 305 });
}

const files: NaturalPersonFiles = {
  frontIdentification: { name: 'front.jpg', type: 'image/jpeg', base64: 'AAAA' },
  backIdentification: { name: 'back.jpg', type: 'image/jpeg', base64: 'BBBB' },
  selfie: { name: 'selfie.jpg', type: 'image/jpeg', base64: 'CCCC' },
};

const kyc: NaturalPersonKyc = {
  identification: '0102030405',
  fingerprintCode: 'A1B2C3',
  names: 'Juan Carlos',
  lastName1: 'Pérez',
  birthDate: '15/05/1990',
  nationality: 'ECUATORIANA',
  sex: 'HOMBRE',
  phoneNumber: '0991234567',
  email: 'juan@example.com',
  province: 'PICHINCHA',
  city: 'QUITO',
  address: 'Av. Amazonas',
  productUuid: 'prod-natural-1a',
};

function client(f: typeof fetch): UanatacaHttpClient {
  return new UanatacaHttpClient({
    env: 'test',
    credentials: { username: 'u', password: 'p' },
    fetchImpl: f,
  });
}

describe('UanatacaHttpClient', () => {
  it('extrae el uuid del header Location en createCertificateRequest', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/piccolos/auth/login')) return authRes();
      if (url.includes('/certificateRequests') && init?.method === 'POST') {
        return new Response(null, {
          status: 201,
          headers: { location: 'https://x/certificateRequests/abc-123' },
        });
      }
      return jsonRes({}, 500);
    });
    const c = client(f as unknown as typeof fetch);
    const r = await c.createCertificateRequest(mapNaturalPersonToCreateInput(kyc, files));
    expect(r.uuid).toBe('abc-123');
    expect(r.locationMissing).toBe(false);
  });

  it('marca locationMissing cuando el 201 no trae Location (estado incierto → reconciliar)', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/piccolos/auth/login')) return authRes();
      if (url.includes('/certificateRequests') && init?.method === 'POST') {
        return new Response(null, { status: 201 });
      }
      return jsonRes({}, 500);
    });
    const c = client(f as unknown as typeof fetch);
    const r = await c.createCertificateRequest(mapNaturalPersonToCreateInput(kyc, files));
    expect(r.uuid).toBeNull();
    expect(r.locationMissing).toBe(true);
  });

  it('NO envía idempotencyKey en el body del POST', async () => {
    let sentBody = '';
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/piccolos/auth/login')) return authRes();
      if (url.includes('/certificateRequests') && init?.method === 'POST') {
        sentBody = String(init?.body ?? '');
        return new Response(null, { status: 201, headers: { location: 'https://x/r/u1' } });
      }
      return jsonRes({}, 500);
    });
    const c = client(f as unknown as typeof fetch);
    await c.createCertificateRequest(mapNaturalPersonToCreateInput(kyc, files, 'local-key'));
    expect(sentBody).not.toContain('idempotencyKey');
    expect(sentBody).not.toContain('local-key');
  });

  it('lanza UanatacaError si el POST no devuelve 201', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/piccolos/auth/login')) return authRes();
      if (url.includes('/certificateRequests') && init?.method === 'POST') {
        return new Response('bad request', { status: 400 });
      }
      return jsonRes({}, 500);
    });
    const c = client(f as unknown as typeof fetch);
    await expect(
      c.createCertificateRequest(mapNaturalPersonToCreateInput(kyc, files)),
    ).rejects.toBeInstanceOf(UanatacaError);
  });

  it('parsea el balance numérico', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes('/piccolos/auth/login')) return authRes();
      if (url.includes('/uanacredits/balance')) return jsonRes(1250.75);
      return jsonRes({}, 500);
    });
    const c = client(f as unknown as typeof fetch);
    expect(await c.getBalance()).toBe(1250.75);
  });

  it('ante 401 invalida el token y reintenta el GET una vez', async () => {
    let first = true;
    const f = vi.fn(async (url: string) => {
      if (url.includes('/piccolos/auth/login')) return authRes();
      if (url.includes('/products')) {
        if (first) {
          first = false;
          return new Response('no', { status: 401 });
        }
        return jsonRes([{ uuid: 'p1' }]);
      }
      return jsonRes({}, 500);
    });
    const c = client(f as unknown as typeof fetch);
    const products = await c.listProducts();
    expect(products).toHaveLength(1);
  });

  it('construye la query de listCertificateRequests', async () => {
    let calledUrl = '';
    const f = vi.fn(async (url: string) => {
      if (url.includes('/piccolos/auth/login')) return authRes();
      if (url.includes('/certificateRequests')) {
        calledUrl = url;
        return jsonRes([]);
      }
      return jsonRes({}, 500);
    });
    const c = client(f as unknown as typeof fetch);
    await c.listCertificateRequests({ q: '0102030405', status: 'ISSUED' });
    expect(calledUrl).toContain('q=0102030405');
    expect(calledUrl).toContain('status=ISSUED');
  });

  it('POST 5xx marca mayHaveCharged=true (pudo cobrar → reconciliar)', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/piccolos/auth/login')) return authRes();
      if (url.includes('/certificateRequests') && init?.method === 'POST') {
        return new Response('boom', { status: 502 });
      }
      return jsonRes({}, 500);
    });
    const c = client(f as unknown as typeof fetch);
    await c
      .createCertificateRequest(mapNaturalPersonToCreateInput(kyc, files))
      .then(() => expect.unreachable('debió lanzar'))
      .catch((e: unknown) => {
        expect(e).toBeInstanceOf(UanatacaError);
        expect((e as UanatacaError).mayHaveCharged).toBe(true);
      });
  });

  it('POST 400 marca mayHaveCharged=false (rechazo pre-cargo)', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/piccolos/auth/login')) return authRes();
      if (url.includes('/certificateRequests') && init?.method === 'POST') {
        return new Response('bad', { status: 400 });
      }
      return jsonRes({}, 500);
    });
    const c = client(f as unknown as typeof fetch);
    await c
      .createCertificateRequest(mapNaturalPersonToCreateInput(kyc, files))
      .then(() => expect.unreachable('debió lanzar'))
      .catch((e: unknown) => {
        expect((e as UanatacaError).mayHaveCharged).toBe(false);
      });
  });

  it('POST con fallo de red marca mayHaveCharged=true', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/piccolos/auth/login')) return authRes();
      if (url.includes('/certificateRequests') && init?.method === 'POST') {
        throw new Error('ECONNRESET');
      }
      return jsonRes({}, 500);
    });
    const c = client(f as unknown as typeof fetch);
    await c
      .createCertificateRequest(mapNaturalPersonToCreateInput(kyc, files))
      .then(() => expect.unreachable('debió lanzar'))
      .catch((e: unknown) => {
        expect(e).toBeInstanceOf(UanatacaError);
        expect((e as UanatacaError).mayHaveCharged).toBe(true);
      });
  });

  it('getBalance rechaza una respuesta null (no la convierte en 0)', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes('/piccolos/auth/login')) return authRes();
      if (url.includes('/uanacredits/balance')) return jsonRes(null);
      return jsonRes({}, 500);
    });
    const c = client(f as unknown as typeof fetch);
    await expect(c.getBalance()).rejects.toBeInstanceOf(UanatacaError);
  });

  it('getBalance acepta un decimal codificado como string', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes('/piccolos/auth/login')) return authRes();
      if (url.includes('/uanacredits/balance')) return jsonRes('1250.75');
      return jsonRes({}, 500);
    });
    const c = client(f as unknown as typeof fetch);
    expect(await c.getBalance()).toBe(1250.75);
  });
});
