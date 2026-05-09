export const languages = { es: 'Español', en: 'English' } as const;
export type Lang = keyof typeof languages;

export const ui = {
  es: {
    'app.title': 'firmar.ec — app',
    'home.title': '¿Qué quieres hacer?',
    'home.firmar': 'Firmar un PDF',
    'home.firmar_soon': 'Próximamente (F3)',
    'home.verificar': 'Verificar un PDF',
    'home.verificar_desc': 'Comprueba si un PDF firmado es auténtico, quién lo firmó y si ha sido modificado.',
    'home.firmar_desc': 'Firma un PDF con tu certificado digital ecuatoriano. Tu llave privada nunca sale de tu navegador.',
    'verificar.title': 'Verificar firma',
    'verificar.dropzone': 'Arrastra un PDF firmado aquí o',
    'verificar.dropzone_pick': 'selecciona un archivo',
    'verificar.processing': 'Verificando localmente…',
    'verificar.no_signature': 'Este PDF no contiene una firma electrónica.',
    'verificar.valid': 'Firma válida',
    'verificar.warning': 'Firma válida con advertencias',
    'verificar.invalid': 'Firma inválida',
    'verificar.detail': 'Ver detalle técnico',
    'verificar.download_report': 'Descargar reporte PDF',
    'paranoia.title': 'Modo paranoia',
    'paranoia.description': 'Verifica tú mismo que tu llave privada nunca sale del navegador.',
    'paranoia.bundle_hash': 'Hash del bundle activo',
    'about.title': 'Acerca',
    'theme.toggle': 'Cambiar tema',
    'lang.switch': 'Cambiar idioma',
    'nav.home': 'Inicio',
    'nav.verificar': 'Verificar',
    'nav.firmar': 'Firmar',
    'nav.paranoia': 'Paranoia',
    'nav.about': 'Acerca',
  },
  en: {
    'app.title': 'firmar.ec — app',
    'home.title': 'What would you like to do?',
    'home.firmar': 'Sign a PDF',
    'home.firmar_soon': 'Coming soon (F3)',
    'home.verificar': 'Verify a PDF',
    'home.verificar_desc': 'Check whether a signed PDF is authentic, who signed it, and whether it was modified.',
    'home.firmar_desc': 'Sign a PDF with your Ecuadorian digital certificate. Your private key never leaves your browser.',
    'verificar.title': 'Verify signature',
    'verificar.dropzone': 'Drop a signed PDF here or',
    'verificar.dropzone_pick': 'pick a file',
    'verificar.processing': 'Verifying locally…',
    'verificar.no_signature': 'This PDF does not contain an electronic signature.',
    'verificar.valid': 'Valid signature',
    'verificar.warning': 'Valid signature with warnings',
    'verificar.invalid': 'Invalid signature',
    'verificar.detail': 'See technical detail',
    'verificar.download_report': 'Download PDF report',
    'paranoia.title': 'Paranoia mode',
    'paranoia.description': 'Verify for yourself that your private key never leaves the browser.',
    'paranoia.bundle_hash': 'Active bundle hash',
    'about.title': 'About',
    'theme.toggle': 'Toggle theme',
    'lang.switch': 'Switch language',
    'nav.home': 'Home',
    'nav.verificar': 'Verify',
    'nav.firmar': 'Sign',
    'nav.paranoia': 'Paranoia',
    'nav.about': 'About',
  },
} as const satisfies Record<Lang, Record<string, string>>;

export type UIKey = keyof (typeof ui)['es'];

// Reactive global lang state via Svelte 5 runes (.svelte.ts extension required)
let _lang = $state<Lang>(initialLang());

function initialLang(): Lang {
  if (typeof window === 'undefined') return 'es';
  try {
    const saved = localStorage.getItem('lang') as Lang | null;
    if (saved === 'es' || saved === 'en') return saved;
  } catch (_) {}
  const nav = navigator?.language ?? 'es';
  return nav.startsWith('en') ? 'en' : 'es';
}

export function getLang(): Lang { return _lang; }
export function setLang(next: Lang): void {
  _lang = next;
  try { localStorage.setItem('lang', next); } catch (_) {}
  document.documentElement.lang = next === 'es' ? 'es-EC' : 'en-US';
}

export function t(key: UIKey): string {
  return (ui[_lang] as Record<string, string>)[key] ?? (ui.es as Record<string, string>)[key] ?? key;
}
