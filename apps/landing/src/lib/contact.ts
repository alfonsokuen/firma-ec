/**
 * Contacto cara-cliente de firmar.ec por WhatsApp — número DEDICADO (instancia
 * `firmarec`: +593 99 399 5618). Es la línea de SOPORTE/CAPTACIÓN de clientes,
 * distinta de la línea de PATROCINIOS de IDKMANAGER (ver Sponsors.astro, 0958888193).
 *
 * Quien escribe a este número queda como contacto de la instancia firmarec: es un
 * lead real y queda alcanzable por los avisos/novedades. El mensaje pre-cargado
 * encuadra la intención (opt-in). Fuente ÚNICA del número: no repetirlo en cada
 * superficie para no desincronizar al cambiarlo (Art. 2).
 */
import type { Lang } from '../i18n/ui.ts';

export const SUPPORT_WHATSAPP_NUMBER = '593993995618';
export const SUPPORT_WHATSAPP_DISPLAY = '+593 99 399 5618';

const OPT_IN_TEXT: Record<Lang, string> = {
  es: 'Hola, quiero información sobre la firma electrónica de firmar.ec y recibir novedades por WhatsApp.',
  en: 'Hi, I would like info about firmar.ec electronic signature and to receive updates on WhatsApp.',
};

export const WA_FAB_ARIA: Record<Lang, string> = {
  es: 'Escríbenos por WhatsApp',
  en: 'Chat with us on WhatsApp',
};

export const WA_FAB_LABEL: Record<Lang, string> = {
  es: 'Escríbenos',
  en: 'Chat with us',
};

/** URL click-to-chat con el mensaje opt-in pre-cargado, según idioma. */
export function supportWhatsappUrl(lang: Lang): string {
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(OPT_IN_TEXT[lang])}`;
}
