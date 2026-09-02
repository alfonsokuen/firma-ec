/**
 * pathAlias.test.ts — regresión del bug "deep-link /firmar/pdf aterriza en
 * la Home" (el header de la tienda enlaza paths reales, el router es hash).
 */
import { describe, expect, it, vi } from 'vitest';
import { bridgePathToHash, resolvePathAlias } from '../src/lib/pathAlias.ts';

describe('resolvePathAlias', () => {
  it('maps the tienda header link /firmar/pdf to the signing route', () => {
    expect(resolvePathAlias('/firmar/pdf')).toBe('/firmar');
  });

  it('maps bare and trailing-slash aliases', () => {
    expect(resolvePathAlias('/firmar')).toBe('/firmar');
    expect(resolvePathAlias('/firmar/')).toBe('/firmar');
    expect(resolvePathAlias('/verificar')).toBe('/verificar');
    expect(resolvePathAlias('/validar-certificado')).toBe('/validar-certificado');
    // La pagina EN del landing manda aqui (en/validate-certificate.astro).
    expect(resolvePathAlias('/validate-certificate')).toBe('/validar-certificado');
    expect(resolvePathAlias('/validate-certificate/')).toBe('/validar-certificado');
    expect(resolvePathAlias('/paranoia')).toBe('/paranoia');
    expect(resolvePathAlias('/about')).toBe('/about');
    expect(resolvePathAlias('/acerca')).toBe('/about');
    expect(resolvePathAlias('/configuracion')).toBe('/configuracion');
    expect(resolvePathAlias('/certificados')).toBe('/certificados');
    expect(resolvePathAlias('/certificados/comprar')).toBe('/certificados/comprar');
  });

  it('does not match prefixes of longer segments', () => {
    expect(resolvePathAlias('/firmarec')).toBeNull();
    expect(resolvePathAlias('/verificarlo')).toBeNull();
  });

  it('leaves root and OS entry points alone', () => {
    expect(resolvePathAlias('/')).toBeNull();
    expect(resolvePathAlias('')).toBeNull();
    expect(resolvePathAlias('/share')).toBeNull();
    expect(resolvePathAlias('/handle-file')).toBeNull();
    expect(resolvePathAlias('/cualquier-cosa')).toBeNull();
  });
});

describe('bridgePathToHash', () => {
  function fakeEnv(pathname: string, search = '', hash = '') {
    const replaceState = vi.fn();
    const loc = { pathname, search, hash } as unknown as Location;
    const hist = { replaceState } as unknown as History;
    return { loc, hist, replaceState };
  }

  it('rewrites the tienda deep-link preserving the query (utm_*)', () => {
    const { loc, hist, replaceState } = fakeEnv(
      '/firmar/pdf',
      '?utm_source=tienda&utm_medium=header',
    );
    const notify = vi.fn();
    bridgePathToHash(loc, hist, notify);
    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/?utm_source=tienda&utm_medium=header#/firmar',
    );
    // regresión SW: sin re-notificar al router, la URL quedaba reescrita
    // pero la Home renderizada (router montaba con la ruta vieja).
    expect(notify).toHaveBeenCalledOnce();
  });

  it('does not notify the router when nothing was rewritten', () => {
    const notify = vi.fn();
    const { loc, hist } = fakeEnv('/', '');
    bridgePathToHash(loc, hist, notify);
    expect(notify).not.toHaveBeenCalled();
  });

  it('does nothing when a hash route is already present', () => {
    const { loc, hist, replaceState } = fakeEnv('/firmar/pdf', '', '#/verificar');
    bridgePathToHash(loc, hist);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('does nothing at the root or on unknown paths', () => {
    for (const path of ['/', '/share', '/handle-file', '/otra']) {
      const { loc, hist, replaceState } = fakeEnv(path);
      bridgePathToHash(loc, hist);
      expect(replaceState).not.toHaveBeenCalled();
    }
  });

  it('fails open if history.replaceState throws', () => {
    const loc = { pathname: '/firmar', search: '', hash: '' } as unknown as Location;
    const hist = {
      replaceState: () => {
        throw new Error('boom');
      },
    } as unknown as History;
    expect(() => bridgePathToHash(loc, hist)).not.toThrow();
  });
});
