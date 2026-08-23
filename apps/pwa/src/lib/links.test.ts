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

import { SUPPORT_WHATSAPP_NUMBER, WHATSAPP_URL, whatsappLink } from './links.ts';

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
