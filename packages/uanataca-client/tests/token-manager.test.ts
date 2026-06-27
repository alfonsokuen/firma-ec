import { describe, expect, it, vi } from 'vitest';
import { UanatacaError, UanatacaTokenManager } from '../src/index.js';

function authResponse(token: string, expiresIn = 305): Response {
  return new Response(
    JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: expiresIn }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function tm(fetchImpl: typeof fetch, now?: () => number, refreshMarginSeconds?: number) {
  return new UanatacaTokenManager({
    authBaseUrl: 'https://auth.test',
    credentials: { username: 'u', password: 'p' },
    fetchImpl,
    ...(now ? { now } : {}),
    ...(refreshMarginSeconds !== undefined ? { refreshMarginSeconds } : {}),
  });
}

describe('UanatacaTokenManager', () => {
  it('cachea el token entre llamadas dentro de la validez', async () => {
    const f = vi.fn(async () => authResponse('tok-1'));
    const mgr = tm(f as unknown as typeof fetch, () => 1000);
    expect(await mgr.getToken()).toBe('tok-1');
    expect(await mgr.getToken()).toBe('tok-1');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('renueva el token tras cruzar el umbral (expires_in - margen)', async () => {
    let t = 0;
    let n = 0;
    const f = vi.fn(async () => authResponse(`tok-${++n}`));
    const mgr = tm(f as unknown as typeof fetch, () => t, 30);
    expect(await mgr.getToken()).toBe('tok-1');
    t += (305 - 30) * 1000 - 1; // justo antes de expirar
    expect(await mgr.getToken()).toBe('tok-1');
    t += 2; // cruza el umbral
    expect(await mgr.getToken()).toBe('tok-2');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('serializa logins concurrentes en una sola petición', async () => {
    let n = 0;
    const f = vi.fn(async () => {
      await Promise.resolve();
      return authResponse(`tok-${++n}`);
    });
    const mgr = tm(f as unknown as typeof fetch, () => 0);
    const [a, b] = await Promise.all([mgr.getToken(), mgr.getToken()]);
    expect(a).toBe('tok-1');
    expect(b).toBe('tok-1');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('invalidate fuerza un nuevo login', async () => {
    let n = 0;
    const f = vi.fn(async () => authResponse(`tok-${++n}`));
    const mgr = tm(f as unknown as typeof fetch, () => 0);
    expect(await mgr.getToken()).toBe('tok-1');
    mgr.invalidate();
    expect(await mgr.getToken()).toBe('tok-2');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('lanza UanatacaError si el login responde no-OK', async () => {
    const f = vi.fn(async () => new Response('bad', { status: 401 }));
    const mgr = tm(f as unknown as typeof fetch);
    await expect(mgr.getToken()).rejects.toBeInstanceOf(UanatacaError);
  });

  it('lanza UanatacaError si la respuesta no trae access_token', async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ token_type: 'Bearer', expires_in: 305 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const mgr = tm(f as unknown as typeof fetch);
    await expect(mgr.getToken()).rejects.toBeInstanceOf(UanatacaError);
  });
});
