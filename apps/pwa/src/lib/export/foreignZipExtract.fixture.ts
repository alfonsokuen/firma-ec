/**
 * Extractor de ZIP AJENO para los tests de `batchZip.ts`.
 *
 * Por qué existe: que nuestro propio lector abra nuestro propio ZIP no prueba
 * nada. Un error simétrico en el escritor y el lector — offsets del directorio
 * central, endianness, el CRC calculado con la misma tabla equivocada en los dos
 * lados — pasa verde y el usuario descubre el archivo corrupto cuando ya borró
 * los originales. El testigo tiene que ser una implementación de ZIP que no
 * escribimos nosotros: `bsdtar`/libarchive en Windows, `unzip` en Linux (ambos
 * ya presentes en las máquinas de desarrollo y en el runner de CI, así que no
 * añade ninguna dependencia al proyecto).
 *
 * Solo se usa desde tests (no lo alcanza `src/main.ts`) y por eso vive en un
 * `.fixture.ts`, que el patrón `include` de Vitest no recoge como suite.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** bsdtar (libarchive) lee ZIP; el `tar` de GNU que trae Git Bash NO. */
const WINDOWS_BSDTAR = 'C:\\Windows\\System32\\tar.exe';

interface ForeignExtractor {
  readonly name: string;
  extract(zipPath: string, destDir: string): void;
}

function probe(bin: string, args: string[]): boolean {
  try {
    execFileSync(bin, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function resolveForeignExtractor(): ForeignExtractor {
  const candidates: ForeignExtractor[] = [];
  if (process.platform === 'win32' && existsSync(WINDOWS_BSDTAR)) {
    candidates.push({
      name: 'bsdtar (libarchive)',
      extract: (zip, dest) => {
        execFileSync(WINDOWS_BSDTAR, ['-x', '-f', zip, '-C', dest], { stdio: 'pipe' });
      },
    });
  }
  if (probe('unzip', ['-v'])) {
    candidates.push({
      name: 'unzip (Info-ZIP)',
      extract: (zip, dest) => {
        try {
          execFileSync('unzip', ['-qq', zip, '-d', dest], { stdio: 'pipe' });
        } catch (e) {
          // Info-ZIP sale con 1 y «zipfile is empty» ante un ZIP VALIDO sin
          // entradas — el caso del lote vacio. bsdtar lo extrae sin rechistar,
          // asi que el test solo se caia en Linux, y solo se vio cuando el CI
          // pudo pasar del lint. Se acepta EXACTAMENTE ese par (codigo 1 + ese
          // aviso): cualquier otro fallo de unzip sigue propagandose, que es lo
          // que hace de esta herramienta un testigo util.
          const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
          const salida = `${err.stderr ?? ''}${err.stdout ?? ''}`;
          if (err.status === 1 && /zipfile is empty/i.test(salida)) return;
          throw e;
        }
      },
    });
  }
  if (probe('bsdtar', ['--version'])) {
    candidates.push({
      name: 'bsdtar (libarchive)',
      extract: (zip, dest) => {
        execFileSync('bsdtar', ['-x', '-f', zip, '-C', dest], { stdio: 'pipe' });
      },
    });
  }
  const chosen = candidates[0];
  if (!chosen) {
    // Fallar en voz alta, nunca `it.skip`: una verificación externa que se salta
    // a sí misma deja el criterio de salida incumplido Y en verde.
    throw new Error(
      'No hay extractor ZIP ajeno disponible (bsdtar/unzip). Instala uno: sin él la ' +
        'verificación con herramienta externa de batchZip no se puede cumplir.',
    );
  }
  return chosen;
}

const extractor = resolveForeignExtractor();

/** Nombre de la herramienta que hará de testigo, para que salga en el título del test. */
export const foreignExtractorName = extractor.name;

/**
 * Escribe el ZIP en un directorio temporal, lo extrae con la herramienta ajena y
 * devuelve `nombre de entrada → bytes`. Limpia el temporal siempre.
 */
export async function extractWithForeignTool(zip: Blob): Promise<Map<string, Uint8Array>> {
  const dir = mkdtempSync(join(tmpdir(), 'fec-zip-'));
  try {
    const zipPath = join(dir, 'lote.zip');
    writeFileSync(zipPath, new Uint8Array(await zip.arrayBuffer()));
    const dest = join(dir, 'out');
    mkdirSync(dest);
    extractor.extract(zipPath, dest);
    const found = new Map<string, Uint8Array>();
    for (const name of readdirSync(dest)) {
      found.set(name, new Uint8Array(readFileSync(join(dest, name))));
    }
    return found;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
