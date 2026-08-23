/**
 * links.test.ts — afirma el DESTINO de los enlaces de WhatsApp.
 *
 * Existe porque el bug del 2026-07-29 (el soporte del modo guiado apuntaba a la
 * línea corporativa de IDKMANAGER) vivió semanas con la suite en verde: ningún
 * test afirmaba a qué número apunta el enlace. El guardarraíl de build mira el
 * bundle, pero solo prueba que la constante esté presente; esto prueba la URL
 * que de verdad consumen WhatsAppSticky y CertHelp.
 */
import { describe, expect, it } from 'vitest';

import {
  SUPPORT_WHATSAPP_NUMBER,
  WHATSAPP_URL,
  resolveWhatsappBase,
  whatsappLink,
} from './links.ts';

/** Línea de la instancia Evolution `firmarec` — la atendida de cara al cliente. */
const FIRMAREC_NUMBER = '593993995618';
/** Línea corporativa de IDKMANAGER: el soporte de firmar.ec NO se atiende ahí. */
const IDKMANAGER_NUMBER = '593958888193';

describe('links.ts — destino de los enlaces de WhatsApp', () => {
  it('la línea de cara al cliente es la de la instancia firmarec', () => {
    expect(SUPPORT_WHATSAPP_NUMBER).toBe(FIRMAREC_NUMBER);
  });

  it('WHATSAPP_URL apunta a esa línea y nunca a la corporativa', () => {
    expect(WHATSAPP_URL).toBe(`https://wa.me/${FIRMAREC_NUMBER}`);
    expect(WHATSAPP_URL).not.toContain(IDKMANAGER_NUMBER);
  });

  it('WHATSAPP_URL es usable como href: sin query y sin barra final', () => {
    // Con `??` en vez de `||`, un ARG vacío dejaba '' y el href resolvía relativo
    // a la página actual — enlace sin destino, sin error visible.
    expect(WHATSAPP_URL).not.toBe('');
    expect(WHATSAPP_URL).not.toContain('?');
    expect(WHATSAPP_URL.endsWith('/')).toBe(false);
  });

  it('whatsappLink añade un solo ?text= y codifica el mensaje', () => {
    const url = whatsappLink('Hola, ¿me ayudan?');

    expect(url.match(/\?/g)).toHaveLength(1);
    expect(url).toBe(
      `https://wa.me/${FIRMAREC_NUMBER}?text=${encodeURIComponent('Hola, ¿me ayudan?')}`,
    );
  });

  it('whatsappLink no rompe la URL con texto que trae & o =', () => {
    const url = whatsappLink('a=1 & b=2');

    expect(url).toBe(`https://wa.me/${FIRMAREC_NUMBER}?text=${encodeURIComponent('a=1 & b=2')}`);
    expect(url.match(/\?/g)).toHaveLength(1);
  });
});

/**
 * Prueba bidireccional del fallback, sobre las formas que `VITE_WHATSAPP_URL`
 * toma de verdad en un build.
 *
 * El número sobrevive HOY solo por el operador `||`: el build de producción
 * hornea la variable vacía — verificado en el bundle servido, que contiene
 * literalmente `{VITE_WHATSAPP_URL:""}`. Con `??` en su lugar el override vacío
 * gana, la base queda `''` y el href resuelve relativo a la página actual: un
 * enlace SIN DESTINO que no lanza ningún error y que nadie ve.
 *
 * Se ejercita `resolveWhatsappBase`, que es la ruta real y no un atajo:
 * `WHATSAPP_URL` es literalmente `resolveWhatsappBase(env['VITE_WHATSAPP_URL'])`.
 * No se puede hacer de otro modo — Vite inlina `import.meta.env` como objeto
 * literal en build, y bajo Vitest cada módulo recibe su propia copia, así que
 * reasignar la env del test NO cambia la que lee `links.ts` (comprobado: el
 * módulo seguía devolviendo el default con la env alterada y `vi.resetModules()`).
 * El valor que de verdad se despacha lo siguen afirmando los tests de arriba
 * sobre `WHATSAPP_URL`, y el bundle lo audita `scripts/check-wa-number.mjs`.
 */
/** Las tres formas en que `VITE_WHATSAPP_URL` llega a un build real. */
const ENV_SHAPES: ReadonlyArray<readonly [label: string, value: string | undefined]> = [
  // La forma EXACTA del bundle en producción: el ARG del Dockerfile se declara
  // vacío, así que Vite inlina `{VITE_WHATSAPP_URL:""}`.
  ['vacía (la del bundle de producción)', ''],
  ['ausente (dev / build sin el ARG)', undefined],
  ['solo espacios (ARG mal pasado)', '   '],
];

describe('resolveWhatsappBase — el fallback aguanta cualquier forma de la env', () => {
  it.each(ENV_SHAPES)('env %s → nunca queda sin destino', (_label, value) => {
    const base = resolveWhatsappBase(value);

    expect(base).not.toBe('');
    // Un href relativo ('' o '/algo') abriría la propia PWA en vez de WhatsApp.
    expect(base.startsWith('https://')).toBe(true);
    expect(new URL(base).host).toBe('wa.me');
    expect(base).toBe(`https://wa.me/${FIRMAREC_NUMBER}`);
  });

  it.each(ENV_SHAPES)('env %s → nunca resuelve a la línea corporativa', (_label, value) => {
    const base = resolveWhatsappBase(value);

    expect(base).not.toContain(IDKMANAGER_NUMBER);
    expect(`${base}?text=hola`).not.toContain(IDKMANAGER_NUMBER);
  });

  it('un override real SÍ gana: el fallback no es un candado', () => {
    expect(resolveWhatsappBase('https://wa.me/593000000000/')).toBe('https://wa.me/593000000000');
  });

  it('un override con query parásita pierde la query, no el destino', () => {
    expect(resolveWhatsappBase('https://wa.me/593000000000?text=ya')).toBe(
      'https://wa.me/593000000000',
    );
  });

  it('el valor despachado hoy sale de este mismo resolvedor', () => {
    // Cierra el lazo entre el helper y la constante que consumen los componentes:
    // si alguien reescribe WHATSAPP_URL sin pasar por aquí, esto se pone rojo.
    expect(WHATSAPP_URL).toBe(resolveWhatsappBase(undefined));
  });
});
