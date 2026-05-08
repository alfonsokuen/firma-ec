import { ui, defaultLang, type Lang, type UIKey } from './ui.ts';

export function getLangFromUrl(url: URL): Lang {
  const [, maybeLang] = url.pathname.split('/');
  if (maybeLang === 'en') return 'en';
  return 'es';
}

export function useTranslations(lang: Lang) {
  return function t(key: UIKey): string {
    return (ui[lang] as Record<string, string>)[key] ?? (ui[defaultLang] as Record<string, string>)[key] ?? key;
  };
}

const ROUTE_MAP: Record<string, { es: string; en: string }> = {
  home: { es: '/', en: '/en/' },
  firmar: { es: '/firmar', en: '/en/sign' },
  verificar: { es: '/verificar', en: '/en/verify' },
  seguridad: { es: '/seguridad', en: '/en/security' },
  faq: { es: '/faq', en: '/en/faq' },
  acerca: { es: '/acerca', en: '/en/about' },
  contacto: { es: '/contacto', en: '/en/contact' },
  glosario: { es: '/glosario', en: '/en/glossary' },
  privacidad: { es: '/privacidad', en: '/en/privacy' },
  terminos: { es: '/terminos', en: '/en/terms' },
  'firma-electronica-ecuador': { es: '/firma-electronica-ecuador', en: '/en/electronic-signature-ecuador' },
  'que-es-firma-pades': { es: '/que-es-firma-pades', en: '/en/what-is-pades-signature' },
  'como-firmar-con-certificado-bce': { es: '/como-firmar-con-certificado-bce', en: '/en/how-to-sign-with-bce-certificate' },
  'comparativos-firmaec': { es: '/comparativos/firmaec', en: '/en/comparisons/firmaec' },
  'comparativos-adobe-sign': { es: '/comparativos/adobe-sign', en: '/en/comparisons/adobe-sign' },
};

export function getHreflangsForRoute(routeKey: string, baseUrl = 'https://firmar.ec'): { es: string; en: string } | null {
  const m = ROUTE_MAP[routeKey];
  if (!m) return null;
  return { es: `${baseUrl}${m.es}`, en: `${baseUrl}${m.en}` };
}

export function getCurrentRouteKey(url: URL): string | null {
  const path = url.pathname.replace(/^\/en\//, '/').replace(/\/$/, '') || '/';
  for (const [key, val] of Object.entries(ROUTE_MAP)) {
    const esPath = val.es.replace(/\/$/, '') || '/';
    if (esPath === path) return key;
  }
  return null;
}

export function localizedUrl(routeKey: string, lang: Lang): string {
  const m = ROUTE_MAP[routeKey];
  if (!m) return lang === 'es' ? '/' : '/en/';
  return m[lang];
}
