#!/usr/bin/env node
/**
 * check-app-version.mjs — guardarraíl de build: la versión que la PWA muestra
 * al usuario tiene que ser la de `apps/pwa/package.json`, y tiene que estar de
 * verdad en el bundle.
 *
 * Por qué existe: el release 0.22.5 salió a producción mostrando "versión
 * 0.22.4" en el pie y en Acerca de, porque `APP_VERSION` era una constante
 * escrita a mano desacoplada de `package.json` (y ya había pasado antes —
 * commit `b1a71da`). Eso se cierra inyectando la versión en build
 * (`__APP_VERSION__`, ver `apps/pwa/appVersion.ts`), pero queda un modo de
 * fallo peor: si alguien quita ese `define`, el bundle sale con el
 * identificador SIN resolver y la app revienta al cargar. El smoke del deploy
 * pide `/` y recibe 200 igualmente — un 200 sobre una pantalla en blanco.
 * Este check mira el bundle.
 *
 * Uso:  node scripts/check-app-version.mjs <dir-de-salida>
 * Falla (exit 1) si la versión no aparece, si aparece el placeholder sin
 * resolver, o si no encontró nada que escanear (vacío = no verificado).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PWA_PKG = resolve(import.meta.dirname, '../apps/pwa/package.json');
/** El placeholder del `define`: si sobrevive al build, no se inyectó nada. */
const UNRESOLVED_PLACEHOLDER = '__APP_VERSION__';
/** Solo el entry bundle interesa; los sourcemaps repiten el fuente original. */
const SCAN_EXTENSIONS = ['.js', '.mjs', '.html'];
const SKIP_SUFFIXES = ['.br', '.gz', '.map'];

function collectFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return out;
    // No se traga: un subárbol ilegible dejaría de escanearse en silencio.
    console.error(`check-app-version: no se pudo leer ${dir}: ${err.message}`);
    process.exit(1);
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
      continue;
    }
    if (SKIP_SUFFIXES.some((s) => entry.name.endsWith(s))) continue;
    if (!SCAN_EXTENSIONS.some((e) => entry.name.endsWith(e))) continue;
    out.push(full);
  }
  return out;
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('check-app-version: falta el directorio a escanear.');
  console.error('uso: node scripts/check-app-version.mjs <dir-de-salida>');
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(PWA_PKG, 'utf8'));
if (!version) {
  console.error(`check-app-version: ${PWA_PKG} no declara "version".`);
  process.exit(1);
}

const files = targets.flatMap((dir) => collectFiles(dir));
if (files.length === 0) {
  console.error(`check-app-version: no se encontró nada escaneable en ${targets.join(', ')}.`);
  console.error('Se falla a propósito: un check que no leyó nada no verifica nada.');
  process.exit(1);
}

const contents = files.map((file) => ({ file, text: readFileSync(file, 'utf8') }));

const unresolved = contents.filter(({ text }) => text.includes(UNRESOLVED_PLACEHOLDER));
if (unresolved.length > 0) {
  console.error(
    `\ncheck-app-version: ${UNRESOLVED_PLACEHOLDER} llegó SIN RESOLVER al bundle:\n` +
      unresolved.map(({ file }) => `  ✗ ${file}`).join('\n'),
  );
  console.error(
    '\nFalta el `define` que inyecta la versión (apps/pwa/vite.config.ts →\n' +
      'appVersionDefine()). La app reventaría al cargar y el smoke del deploy\n' +
      'seguiría devolviendo 200.\n',
  );
  process.exit(1);
}

if (!contents.some(({ text }) => text.includes(`"${version}"`) || text.includes(`'${version}'`))) {
  console.error(
    `\ncheck-app-version: el bundle NO contiene la versión ${version} ` +
      'declarada en apps/pwa/package.json.\n' +
      'El usuario vería una versión distinta a la desplegada — el defecto que\n' +
      'este check existe para impedir.\n',
  );
  process.exit(1);
}

console.log(
  `check-app-version: OK — ${files.length} archivos escaneados, versión ${version} presente y sin placeholders.`,
);
