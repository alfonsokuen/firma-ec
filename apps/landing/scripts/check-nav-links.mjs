/**
 * check-nav-links — guarda HERMÉTICA (sin red) sobre el `dist` construido.
 *
 * Fija dos decisiones que ya se rompieron una vez (bug reportado 2026-09-02):
 *  1. "Validar certificado" en el menú es una ACCIÓN: apunta a la herramienta
 *     en la app, no al artículo SEO. Escritorio y móvil, ES y EN.
 *  2. El artículo NO puede quedarse sin enlace de todo el sitio: el pie lo
 *     enlaza en las dos lenguas (perdió sus 76 anclas al mover el menú).
 *
 * Corre dentro de `pnpm build`, así que la vigila el CI. La spec Playwright
 * equivalente habla con producción y no puede ser un gate de PR.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DIST = path.resolve(import.meta.dirname, '../dist');
const TOOL_URL = 'https://app.firmar.ec/#/validar-certificado';
const ARTICLE = { es: '/validar-certificado/', en: '/en/validate-certificate/' };

const PAGES = [
  { file: 'index.html', lang: 'es', navLabel: 'Validar certificado' },
  { file: 'en/index.html', lang: 'en', navLabel: 'Validate certificate' },
];

const errors = [];

for (const { file, lang, navLabel } of PAGES) {
  const html = await readFile(path.join(DIST, file), 'utf8');

  // 1. El menú apunta a la herramienta. Debe haber DOS anclas (escritorio y
  //    móvil) y NINGUNA de ellas al artículo.
  const toTool = [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].filter(
    ([, , text]) => text.trim() === navLabel,
  );
  if (toTool.length !== 2) {
    errors.push(`${file}: esperaba 2 anclas de menú "${navLabel}", encontré ${toTool.length}`);
  }
  for (const [, href, text] of toTool) {
    if (href !== TOOL_URL) {
      errors.push(`${file}: el menú "${text.trim()}" apunta a "${href}", no a la herramienta`);
    }
  }

  // 2. El artículo conserva un enlace sitewide (el pie).
  if (!html.includes(`href="${ARTICLE[lang]}"`)) {
    errors.push(`${file}: no queda ningún enlace a "${ARTICLE[lang]}" (el pie debería traerlo)`);
  }
}

if (errors.length > 0) {
  console.error('check-nav-links FALLÓ:');
  for (const e of errors) console.error(`  • ${e}`);
  process.exit(1);
}
console.log(`check-nav-links OK: menú → herramienta y artículo enlazado en ${PAGES.length} lenguas`);
