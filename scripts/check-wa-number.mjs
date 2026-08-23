#!/usr/bin/env node
/**
 * check-wa-number.mjs — guardarraíl de build: ninguna superficie de firmar.ec
 * puede publicar la línea corporativa de IDKMANAGER.
 *
 * Por qué existe: hasta 2026-07-29 la barra de ayuda del modo guiado de la PWA
 * ("¿Necesitas ayuda? Escríbenos por WhatsApp") apuntaba a la línea corporativa,
 * así que los clientes de soporte escribían al WhatsApp de IDKMANAGER. El bug fue
 * invisible durante semanas: build verde, sitio funcionando, tests en verde —
 * nadie mira el bundle servido. Este check mira el bundle.
 *
 * Uso:  node scripts/check-wa-number.mjs <dir-de-salida> [...más dirs]
 * Falla (exit 1) si encuentra el número prohibido, y también si no encontró NADA
 * que escanear: un guardarraíl que pasa sin haber leído un archivo es un falso
 * verde (qa-verify §Paso 4-bis: "vacío = no verificado").
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Línea corporativa de IDKMANAGER. Es un literal a propósito: el valor
 * prohibido ES el objeto del check, no configuración de entorno.
 * Se cazan las formas en que puede aparecer en un artefacto construido.
 */
const FORBIDDEN = [
  { pattern: '593958888193', label: 'línea IDKMANAGER (E.164)' },
  { pattern: '+593 95 888 8193', label: 'línea IDKMANAGER (formato display)' },
  { pattern: '0958888193', label: 'línea IDKMANAGER (formato local)' },
];

const SCAN_EXTENSIONS = ['.js', '.mjs', '.css', '.html', '.json', '.webmanifest', '.txt', '.xml'];

/** Ficheros derivados: ya se comprueba el original, y comprimido no es legible. */
const SKIP_SUFFIXES = ['.br', '.gz', '.map'];

function collectFiles(dir, out = []) {
  let entries;
  try {
    // withFileTypes evita un statSync por entrada: un symlink roto o una carrera
    // en dist tumbaría el build con ENOENT por una razón espuria.
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // Un dir raíz ausente lo reporta el contador global (files.length === 0).
    // Cualquier otro error de lectura NO se traga: un subárbol ilegible dejaría
    // de escanearse en silencio, que es justo el falso verde que evita el check.
    if (err.code === 'ENOENT') return out;
    console.error(`check-wa-number: no se pudo leer ${dir}: ${err.message}`);
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
  console.error('check-wa-number: falta el directorio a escanear.');
  console.error('uso: node scripts/check-wa-number.mjs <dir-de-salida> [...más dirs]');
  process.exit(1);
}

const files = targets.flatMap((dir) => collectFiles(dir));

if (files.length === 0) {
  console.error(
    `check-wa-number: no se encontró ningún archivo escaneable en ${targets.join(', ')}.`,
  );
  console.error('Se falla a propósito: un check que no leyó nada no verifica nada.');
  process.exit(1);
}

const violations = [];
for (const file of files) {
  const content = readFileSync(file, 'utf8');
  for (const { pattern, label } of FORBIDDEN) {
    if (content.includes(pattern)) violations.push({ file, pattern, label });
  }
}

if (violations.length > 0) {
  console.error(
    `\ncheck-wa-number: ${violations.length} ocurrencia(s) de la línea corporativa de IDKMANAGER en la salida de build:\n`,
  );
  for (const { file, pattern, label } of violations) {
    console.error(`  ✗ ${file}\n      ${pattern}  (${label})`);
  }
  console.error(
    '\nEl soporte de firmar.ec se atiende en la instancia Evolution `firmarec`.\n' +
      'Importa el número de apps/pwa/src/lib/links.ts o apps/landing/src/lib/contact.ts;\n' +
      'no escribas el literal en un componente.\n',
  );
  process.exit(1);
}

/**
 * Aserción POSITIVA: el trade es bidireccional. Sin esto, un typo en la constante
 * o un refactor que borre el CTA dejan la salida sin enlace de WhatsApp usable y
 * el check imprime OK — el mismo falso verde que motivó el script.
 * `WA_EXPECTED_NUMBER=<otro número>` cambia el esperado; `=off` la desactiva.
 * Un valor VACÍO cae al default y NO desactiva nada: `ARG` sin pasar deja la env
 * como '' en Docker, y un guardarraíl no se apaga por un descuido (fail-closed).
 */
const rawExpected = process.env.WA_EXPECTED_NUMBER?.trim();
const EXPECTED = rawExpected || '593993995618';

if (EXPECTED === 'off') {
  console.log('check-wa-number: aserción positiva DESACTIVADA (WA_EXPECTED_NUMBER=off).');
} else if (!files.some((file) => readFileSync(file, 'utf8').includes(EXPECTED))) {
  console.error(
    `\ncheck-wa-number: la salida de build NO contiene el número esperado ${EXPECTED}.\n` +
      'Los enlaces de WhatsApp quedarían sin destino o apuntando a otro sitio.\n' +
      'Si el build usa a propósito otra línea, pasa WA_EXPECTED_NUMBER con ese número (o =off).\n',
  );
  process.exit(1);
}

console.log(
  `check-wa-number: OK — ${files.length} archivos escaneados, 0 ocurrencias prohibidas` +
    (EXPECTED === 'off' ? '.' : `, ${EXPECTED} presente.`),
);
