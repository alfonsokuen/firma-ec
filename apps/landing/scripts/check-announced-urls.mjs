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
// IMPORTA la función real en vez de reimplementarla o de extraer su tabla por
// regex. La primera versión la extraía, y un panel de revisión demostró que
// TypeScript válido —una entrada partida en varias líneas, una coma dentro de la
// regex, un flag— la descartaba en silencio: la guarda seguía en verde midiendo
// de menos, y cuando enrojecía culpaba a un fichero de contenido que estaba
// bien. Un detector que se encoge solo es peor que no tenerlo.
//
// La tabla de rutas del router no se puede importar (vive dentro de un
// componente Svelte), así que esa sí se lee del fuente, con cuatro anclas de
// autocomprobación que abortan si el formato cambia.
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePathAlias } from '../../pwa/src/lib/pathAlias.ts';

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

/** Rutas hash reales del router, leídas de su fichero. */
function leerRutas() {
  const fichero = 'apps/pwa/src/App.svelte';
  const src = leerFuente(fichero);
  const i = src.indexOf('const routes');
  // La marca de fin es la LÍNEA que abre con la clave comodín, no cualquier
  // aparición del texto: un comentario dentro de la tabla que la mencione
  // recortaba la ventana en silencio (2026-09-02: una ruta nueva quedó fuera y
  // el recuento bajó a 14 sin que nada fallara).
  const fin = /^\s*'\*':/m.exec(src.slice(i));
  const j = fin ? i + fin.index : -1;
  // `indexOf` devuelve -1 y `slice(a, -1)` se tragaría el resto del fichero sin
  // avisar: ampliaría el bloque analizado en silencio.
  if (i === -1 || j === -1) {
    throw new Error(
      `check-announced-urls: no encontré la tabla de rutas en ${fichero}. ` +
        'Cambió el formato del router: arregla este extractor antes de seguir.',
    );
  }
  const rutas = new Set([...src.slice(i, j).matchAll(/^\s*'(\/[^']*)':/gm)].map((m) => m[1]));
  // La ruta que llevan impresa TODOS los PDF firmados (QR: `#/verificar`) no solo
  // debe existir: debe apuntar al verificador. Con `'/verificar': Home` la clave
  // existe y el QR aterriza en la portada con 200. Lo demostró la revisión del
  // 2026-09-02 mutando el router: sin esta ancla, verde falso.
  const lineaVerificar = src.slice(i, j).split('\n').find((l) => /^\s*'\/verificar':/.test(l));
  if (!lineaVerificar || !lineaVerificar.includes('Verificar.svelte')) {
    throw new Error(
      `check-announced-urls: en ${fichero} la ruta '/verificar' no apunta a Verificar.svelte. ` +
        'Esa ruta va impresa en el QR de todos los PDF ya firmados: cambiarla los manda a la portada.',
    );
  }
  for (const conocida of ['/', '/firmar', '/verificar', '/validar-certificado']) {
    if (!rutas.has(conocida)) {
      throw new Error(
        `check-announced-urls: el extractor de rutas no encontró "${conocida}" en ${fichero}. ` +
          'Cambió el formato del router: arregla este extractor antes de seguir.',
      );
    }
  }
  return rutas;
}

const RUTAS = leerRutas();

// Entradas legítimas que no son rutas del router.
const NO_SON_RUTAS = new Set(['/', '/install']);

// Frontera IZQUIERDA del host: sin ella, `notapp.firmar.ec/x` se trataba como
// nuestro y el mensaje mentía sobre qué host evaluaba. Un artículo advirtiendo
// de un dominio suplantador habría bloqueado el despliegue.
const HOST = String.raw`(?:^|[^a-zA-Z0-9.\-])(?:https?:\/\/)?app\.firmar\.ec`;
const RE_PATH = new RegExp(`${HOST}\/(?!#)([a-zA-Z0-9\-./]*)`, 'g');
const RE_HASH = new RegExp(`${HOST}\/#(\/[a-zA-Z0-9\-./]*)`, 'g');

// Válvula de escape, igual que `EXCEPTIONS` en check-llms: una línea que
// contenga este marcador queda fuera del barrido. Existe porque este sitio
// publica contenido de SEGURIDAD, y un ejemplo de URL falsa —o un bloque de
// código— es contenido legítimo que si no bloquearía el deploy.
const MARCA_IGNORAR = 'check-announced-urls-ignore';

/** Un último segmento con punto es un fichero servido por el origen
 *  (`/sw.js`, `/manifest.webmanifest`, `/robots.txt`), no una ruta del router:
 *  la tabla de alias no lo cubre ni tiene por qué. */
const esFichero = (p) => p.slice(p.lastIndexOf('/') + 1).includes('.');

async function ficheros(dir, acc = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await ficheros(full, acc);
    else if (/\.(astro|md|mdx|ts|tsx|svelte|json|txt|html|xml|webmanifest)$/.test(e.name)) acc.push(full);
  }
  return acc;
}

const errores = [];
const revisados = [];
for (const root of ROOTS) revisados.push(...(await ficheros(root)));

for (const f of revisados) {
  const donde = relative(LANDING, f);

  for (const linea of readFileSync(f, 'utf8').split('\n')) {
    if (linea.includes(MARCA_IGNORAR)) continue;

    // `app.firmar.ec/<path>` — anunciado para teclear o enlazado.
    for (const m of linea.matchAll(RE_PATH)) {
      const p = `/${m[1]}`.replace(/\/+$/, '') || '/';
      if (p === '/' || NO_SON_RUTAS.has(p) || esFichero(p)) continue;
      const destino = resolvePathAlias(p);
      if (destino === null || !RUTAS.has(destino)) {
        errores.push(
          `${donde}: anuncia app.firmar.ec${p}, que la app NO resuelve (serviría la portada con 200)`,
        );
      }
    }

    // `app.firmar.ec/#/<ruta>` — enlace directo a una ruta hash.
    for (const m of linea.matchAll(RE_HASH)) {
      const r = m[1].replace(/\/+$/, '') || '/';
      if (esFichero(r)) continue;
      if (!RUTAS.has(r)) {
        errores.push(
          `${donde}: enlaza #${r}, que NO es una ruta del router (el comodín serviría la portada)`,
        );
      }
    }
  }
}

if (errores.length > 0) {
  console.error('check-announced-urls FALLÓ:');
  for (const e of [...new Set(errores)]) console.error(`  • ${e}`);
  console.error(
    `\nSi la URL es un EJEMPLO a proposito (contenido de seguridad, bloque de codigo),\n` +
      `anade "${MARCA_IGNORAR}" en esa misma linea.`,
  );
  process.exit(1);
}
console.log(
  `check-announced-urls OK: ${revisados.length} ficheros revisados; toda URL de app.firmar.ec anunciada resuelve (${RUTAS.size} rutas)`,
);
