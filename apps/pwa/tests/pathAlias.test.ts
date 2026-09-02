/**
 * pathAlias.test.ts — regresión del bug "deep-link /firmar/pdf aterriza en
 * la Home" (el header de la tienda enlaza paths reales, el router es hash).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  NOT_FOUND_ROUTE,
  bridgePathToHash,
  resolvePathAlias,
  sanitizeAttemptedPath,
} from '../src/lib/pathAlias.ts';

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
    // Slugs EN que las paginas en ingles ANUNCIAN como texto para teclear;
    // sin alias caian en la portada con 200 (fallo mudo, medido en prod).
    expect(resolvePathAlias('/sign')).toBe('/firmar');
    expect(resolvePathAlias('/sign/pdf')).toBe('/firmar');
    expect(resolvePathAlias('/verify')).toBe('/verificar');
    expect(resolvePathAlias('/firmar-lote')).toBe('/firmar-lote');
    expect(resolvePathAlias('/batch-sign')).toBe('/firmar-lote');
    // `/firmar-lote` NO debe caer en el alias de `/firmar`.
    expect(resolvePathAlias('/firmar-lotes')).toBe(null);
    expect(resolvePathAlias('/signature')).toBe(null);
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

  it('does nothing at the root or on OS entry points', () => {
    // Un path DESCONOCIDO ya no se deja pasar: desde el 2026-09-02 se desvía a
    // "no encontrado" (ver el describe de abajo). Este test protegía también
    // ese comportamiento antiguo, que era el sumidero mudo.
    for (const path of ['/', '/share', '/handle-file']) {
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

describe('bridgePathToHash — un path desconocido NO puede caer en la portada', () => {
  // Hasta el 2026-09-02, un path sin alias se dejaba pasar y la app montaba la
  // Home con 200: el sumidero mudo que hizo invisibles cuatro rutas rotas
  // durante meses. Ahora va a la pantalla de no encontrado, con el path
  // intentado, para que un humano (o un canary) pueda VER que algo falló.
  function fakeEnv(pathname: string, search = '', hash = '') {
    const replaceState = vi.fn();
    const loc = { pathname, search, hash } as unknown as Location;
    const hist = { replaceState } as unknown as History;
    return { loc, hist, replaceState };
  }

  it('manda un path desconocido a la ruta de no encontrado, con el path en la query', () => {
    const { loc, hist, replaceState } = fakeEnv('/validate-certificat');
    const notify = vi.fn();
    bridgePathToHash(loc, hist, notify);
    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      `/#${NOT_FOUND_ROUTE}?p=${encodeURIComponent('/validate-certificat')}`,
    );
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('conserva la query original (utm_*) también en el desvío', () => {
    const { loc, hist, replaceState } = fakeEnv('/nada', '?utm_source=x');
    bridgePathToHash(loc, hist, vi.fn());
    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      `/?utm_source=x#${NOT_FOUND_ROUTE}?p=${encodeURIComponent('/nada')}`,
    );
  });

  it('deja en paz la raíz y las entradas del sistema operativo', () => {
    for (const p of ['/', '/share', '/handle-file']) {
      const { loc, hist, replaceState } = fakeEnv(p);
      bridgePathToHash(loc, hist, vi.fn());
      expect(replaceState, p).not.toHaveBeenCalled();
    }
  });

  it('un alias conocido sigue resolviendo a su ruta, no a no encontrado', () => {
    const { loc, hist, replaceState } = fakeEnv('/sign');
    bridgePathToHash(loc, hist, vi.fn());
    expect(replaceState).toHaveBeenCalledWith(null, '', '/#/firmar');
  });
});

describe('sanitizeAttemptedPath — lo que la pantalla de no encontrado puede pintar', () => {
  // La pantalla refleja el path intentado como texto en un dominio de confianza.
  // Sin filtro, `?p=Llame+al+0999...` pintaba "Dirección intentada: Llame al 0999
  // 123 456 para recuperar su certificado": no es XSS (Svelte escapa), es
  // suplantación de contenido (CWE-451) para un WhatsApp de phishing con enlace
  // real a app.firmar.ec. Un path real nunca lleva espacios: el navegador los
  // codifica. Todo lo que no parezca un path, no se pinta.
  it('acepta un path real y lo devuelve decodificado', () => {
    expect(sanitizeAttemptedPath('/validate-certificat')).toBe('/validate-certificat');
    expect(sanitizeAttemptedPath('/verificaci%C3%B3n')).toBe('/verificación');
    expect(sanitizeAttemptedPath('/firmar/pdf')).toBe('/firmar/pdf');
  });

  it('rechaza texto que no es un path', () => {
    expect(sanitizeAttemptedPath('Llame al 0999 123 456 para recuperar su certificado')).toBe(null);
    expect(sanitizeAttemptedPath('/Llame al 0999')).toBe(null);
    expect(sanitizeAttemptedPath('javascript:alert(1)')).toBe(null);
    expect(sanitizeAttemptedPath('<b>x</b>')).toBe(null);
    expect(sanitizeAttemptedPath('')).toBe(null);
    expect(sanitizeAttemptedPath(null)).toBe(null);
  });

  it('rechaza paths absurdamente largos y codificación rota', () => {
    expect(sanitizeAttemptedPath(`/${'a'.repeat(300)}`)).toBe(null);
    expect(sanitizeAttemptedPath('/%E0%A4%A')).toBe(null);
  });
});
