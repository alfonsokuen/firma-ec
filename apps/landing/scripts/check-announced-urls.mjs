// Pre-build guard: ninguna página puede anunciar una URL de la app que la app
// no sepa resolver.
//
// POR QUÉ
// -------
// El 2026-09-02 se encontraron CUATRO rutas anunciadas que no resolvían:
// `/validate-certificate`, `/sign`, `/verify` y `/firmar-lote`, más un enlace a
// `#/verify`, una ruta hash que no existe. En todos los casos la SPA respondía
// **200 con la portada**. Un 200 no lo ve ningún monitor, así que el fallo pudo
// vivir meses: lo encontró una revisión, no una alerta.
//
// La causa raíz eran dos fuentes de verdad sin nadie en medio: el landing decide
// qué URLs ANUNCIA (traduciendo el path como si fuera texto) y `pathAlias.ts`
// decide cuáles RESUELVEN. Esta guarda las cruza en cada build.
//
// Lee las tablas REALES de la PWA en vez de copiarlas — copiarlas crearía la
// tercera fuente de verdad. Si la extracción deja de casar, aborta con un
// mensaje explícito: un guard que se salta a sí mismo cuando no encuentra su
// fuente de verdad es justo lo que este guard existe para impedir.
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const LANDING = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(LANDING, '../..');
const ROOTS = [join(LANDING, 'src'), join(LANDING, 'public')];

function leerFuente(relPath) {
  try {
    return readFileSync(join(REPO, relPath), 'utf8');
  } catch (err) {
    throw new Error(
      `check-announced-urls: no se pudo leer ${relPath} (${err.code ?? 'error'}). ` +
        'La imagen de la landing debe copiarlo (ver landing.Dockerfile). ' +
        'NUNCA degradar a "sin comprobar".',
    );
  }
}

/** Tabla de alias de la PWA, extraída de su fichero real. */
function leerAlias() {
  const src = leerFuente('apps/pwa/src/lib/pathAlias.ts');
  const bloque = src.slice(src.indexOf('const ALIASES'), src.indexOf('];', src.indexOf('const ALIASES')));
  const alias = [...bloque.matchAll(/\[\s*(\/\^[^,]+?\/)\s*,\s*'([^']+)'\s*\]/g)].map(([, re, destino]) => [
    new RegExp(re.slice(1, -1)),
    destino,
  ]);
  if (alias.length < 8) {
    throw new Error(
      `check-announced-urls: solo extraje ${alias.length} alias de pathAlias.ts (esperaba ≥8). ` +
        'Cambió el formato de la tabla: arregla este extractor antes de seguir.',
    );
  }
  return alias;
}

/** Rutas hash reales del router, extraídas de su fichero real. */
function leerRutas() {
  const src = leerFuente('apps/pwa/src/App.svelte');
  const bloque = src.slice(src.indexOf('const routes'), src.indexOf("'*':"));
  const rutas = new Set([...bloque.matchAll(/^\s*'(\/[^']*)':/gm)].map((m) => m[1]));
  for (const conocida of ['/', '/firmar', '/verificar', '/validar-certificado']) {
    if (!rutas.has(conocida)) {
      throw new Error(
        `check-announced-urls: el extractor de rutas no encontró "${conocida}" en App.svelte. ` +
          'Cambió el formato del router: arregla este extractor antes de seguir.',
      );
    }
  }
  return rutas;
}

const ALIAS = leerAlias();
const RUTAS = leerRutas();

/** Misma semántica que `resolvePathAlias`: primer patrón que casa. */
const resolver = (p) => (p === '/' ? null : (ALIAS.find(([re]) => re.test(p))?.[1] ?? null));

// Autocomprobación del extractor: si estas dejan de cumplirse, lo que se rompió
// es la extracción, no el contenido — y el mensaje lo dice.
for (const [entrada, esperado] of [
  ['/validate-certificate', '/validar-certificado'],
  ['/firmar', '/firmar'],
  ['/no-existe-esta-ruta', null],
]) {
  if (resolver(entrada) !== esperado) {
    throw new Error(
      `check-announced-urls: la autocomprobación falló (${entrada} → ${resolver(entrada)}, esperaba ${esperado}). ` +
        'El extractor de alias no está leyendo bien pathAlias.ts.',
    );
  }
}

// Entradas legítimas que no son rutas del router.
const NO_SON_RUTAS = new Set(['/', '/install']);

async function ficheros(dir, acc = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await ficheros(full, acc);
    else if (/\.(astro|md|mdx|ts|tsx|svelte|json|txt|html)$/.test(e.name)) acc.push(full);
  }
  return acc;
}

const errores = [];
const revisados = [];
for (const root of ROOTS) revisados.push(...(await ficheros(root)));

for (const f of revisados) {
  const txt = readFileSync(f, 'utf8');
  const donde = relative(LANDING, f);

  // `app.firmar.ec/<path>` — anunciado para teclear o enlazado.
  for (const m of txt.matchAll(/app\.firmar\.ec\/(?!#)([a-zA-Z0-9\-/]*)/g)) {
    const p = `/${m[1]}`.replace(/\/+$/, '') || '/';
    if (p === '/' || NO_SON_RUTAS.has(p)) continue;
    const destino = resolver(p);
    if (destino === null || !RUTAS.has(destino)) {
      errores.push(`${donde}: anuncia app.firmar.ec${p}, que la app NO resuelve (serviría la portada con 200)`);
    }
  }

  // `app.firmar.ec/#/<ruta>` — enlace directo a una ruta hash.
  for (const m of txt.matchAll(/app\.firmar\.ec\/#(\/[a-zA-Z0-9\-/]*)/g)) {
    const r = m[1].replace(/\/+$/, '') || '/';
    if (!RUTAS.has(r)) {
      errores.push(`${donde}: enlaza #${r}, que NO es una ruta del router (el comodín serviría la portada)`);
    }
  }
}

if (errores.length > 0) {
  console.error('check-announced-urls FALLÓ:');
  for (const e of [...new Set(errores)]) console.error(`  • ${e}`);
  process.exit(1);
}
console.log(
  `check-announced-urls OK: ${revisados.length} ficheros revisados; toda URL de app.firmar.ec anunciada resuelve (${ALIAS.length} alias, ${RUTAS.size} rutas)`,
);
