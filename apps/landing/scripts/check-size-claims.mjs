// Pre-build guard: no page may claim a PDF size limit for firmar.ec that the
// PWA does not actually enforce.
//
// WHY
// ---
// The published copy said "50 MB en móvil y 200 MB en escritorio" across six
// files. Both halves were false: there is no per-device branch anywhere in the
// code, and 200 MB exists in no constant. The number had been copied by hand
// into every page, so nothing could ever notice it drifting from the source of
// truth. This reads the real constants and fails the build on any MB figure
// that is neither one of them nor an explicitly sourced third-party number.
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const LANDING = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(LANDING, '../..');
const CONTENT = join(LANDING, 'src/content');
// Raices a barrer. `src/pages` porque el JSON-LD del `faqPage` repite a mano el
// texto del cuerpo, y `public` porque `llms.txt`/`llms-full.txt` hacen lo mismo
// para los motores. Ambas quedaron fuera del barrido original y una auditoria
// independiente lo probo inyectando "200 MB" en cada una: EXIT=0 en las dos.
const ROOTS = [CONTENT, join(LANDING, 'src/pages'), join(LANDING, 'public')];

/** Read `<name> = <n> * 1024 * 1024` out of a source file and return MB. */
function readMegabyteConstant(relPath, pattern) {
  const abs = join(REPO, relPath);
  let src;
  try {
    src = readFileSync(abs, 'utf8');
  } catch (err) {
    // Ocurrio de verdad: la imagen Docker de la landing solo copia
    // `apps/landing` + `scripts/check-wa-number.mjs`, asi que este guard
    // abortaba el build con un ENOENT crudo. El mensaje explicito ahorra el
    // rato de diagnostico y dice el arreglo. NUNCA degradar a "sin comprobar":
    // un guard que se salta a si mismo cuando no encuentra su fuente de verdad
    // es exactamente lo que este guard existe para impedir.
    throw new Error(
      `check-size-claims: no se pudo leer ${relPath} (${err.code ?? 'error'}). ` +
        'Este guard contrasta las cifras publicadas contra las constantes reales de la PWA, ' +
        'asi que ese fichero debe existir en el contexto de build — si es una imagen Docker, ' +
        'copialo en el Dockerfile (ver infra/docker/landing.Dockerfile).',
    );
  }
  const m = src.match(pattern);
  if (!m) {
    throw new Error(
      `check-size-claims: could not read the size constant from ${relPath}. ` +
        'The constant moved or was renamed — update this guard, do not delete it.',
    );
  }
  return Number(m[1]);
}

// Source of truth for what the app accepts. If these move, the guard moves the
// allowed set with them and every stale page fails immediately.
const SINGLE_FILE_MB = readMegabyteConstant(
  'apps/pwa/src/ui/Drop.svelte',
  /MAX_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/,
);
const BATCH_FILE_MB = readMegabyteConstant(
  'apps/pwa/src/lib/workers/sign-queue.ts',
  /MAX_BATCH_FILE_SIZE_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/,
);

// Third-party figures the copy is allowed to quote. Every entry must be backed
// by an outbound source link in the page that uses it (see the FirmaEC rows in
// the comparison tables). Add a number here only with its source.
const THIRD_PARTY_MB = new Map([
  [4, 'FirmaEC Móvil — registro de cambios oficial de firmadigital.gob.ec (v5.0.0)'],
  [512, 'FirmaEC escritorio — registro de cambios oficial de firmadigital.gob.ec (v5.0.0)'],
]);

const allowed = new Set([SINGLE_FILE_MB, BATCH_FILE_MB, ...THIRD_PARTY_MB.keys()]);

// Extensiones que pueden afirmar un limite de tamano. NO basta con `.md`:
// una auditoria independiente (2026-08-23) demostro el punto ciego inyectando
// "200 MB" en `src/pages/**/*.astro` y en `public/llms-full.txt` — el guard
// salia EXIT=0 en ambos. Y son justo los ficheros donde la cifra esta copiada
// a mano, porque el JSON-LD del `faqPage` y los `llms*.txt` repiten el texto
// del cuerpo. Un guard que no cubre donde se copia el dato da falsa seguridad.
const CHECKED_EXT = ['.md', '.astro', '.txt'];

async function* claimFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      yield* claimFiles(full);
    } else if (CHECKED_EXT.some((ext) => entry.name.endsWith(ext))) {
      yield full;
    }
  }
}

const MB_CLAIM = /(\d+(?:[.,]\d+)?)\s*MB\b/g;

// Only figures presented as a LIMIT are checked. A line like "the app weighs
// ~3-5 MB" states a download size, not a cap, and must not trip the guard —
// while every wording the false claim ever used ("hasta X MB", "Tamaño máximo",
// "Supports up to X MB", "per PDF") is covered here.
const LIMIT_CONTEXT =
  /hasta|máximo|maximum|up to|limit|límite|per PDF|por PDF|per file|por archivo|per document|por documento|tamaño máximo|admite|accepts|soporta|supports/i;

const violations = [];
for (const root of ROOTS) {
for await (const file of claimFiles(root)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!LIMIT_CONTEXT.test(line)) return;
    for (const m of line.matchAll(MB_CLAIM)) {
      const mb = Number(m[1].replace(',', '.'));
      if (allowed.has(mb)) continue;
      violations.push({ file: relative(REPO, file), line: i + 1, mb, text: line.trim() });
    }
  });
}
}

if (violations.length > 0) {
  console.error('ERROR: size claims that no constant in the codebase backs:');
  for (const v of violations) {
    console.error(`  - ${v.file}:${v.line} claims ${v.mb} MB`);
    console.error(`      ${v.text}`);
  }
  console.error(
    `\nThe app enforces ${SINGLE_FILE_MB} MB per PDF (apps/pwa/src/ui/Drop.svelte) and ` +
      `${BATCH_FILE_MB} MB per file in batch signing (apps/pwa/src/lib/workers/sign-queue.ts), ` +
      'with no per-device branch. Fix the copy, or add the number to THIRD_PARTY_MB together ' +
      'with the source that backs it.',
  );
  process.exit(1);
}

console.log(
  `check-size-claims OK: every MB figure in src/content, src/pages and public matches ${SINGLE_FILE_MB} MB / ` +
    `${BATCH_FILE_MB} MB (batch) or a sourced third-party number`,
);
