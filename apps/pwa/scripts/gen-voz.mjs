#!/usr/bin/env node
/**
 * gen-voz.mjs — F2b modo guiado: genera los clips de voz pre-renderizados
 * ("Fe", es-EC-AndreaNeural) para el modo guiado "Firmar Fácil" y su
 * manifest de consumo (`apps/pwa/public/voz-firma/manifest.json`).
 *
 * Fuente de verdad: las claves `guided.voz.*` (bloque `es`) de
 * `apps/pwa/src/lib/i18n.svelte.ts`. Este script NO duplica los textos: los
 * extrae de ese archivo con una regex acotada a la sección `es`, así que si
 * F2a cambia el copy, re-ejecutar este script re-sincroniza audio + hash sin
 * tocar el script.
 *
 * Contrato del manifest (fijado por F2a en voice.svelte.ts):
 *   { "<voiceKey>": { "file": "<voiceKey>.mp3", "hash": "<sha256 truncado>" } }
 *
 * Uso:
 *   node apps/pwa/scripts/gen-voz.mjs
 *   EDGE_TTS_BIN=/otra/ruta/edge-tts.exe node apps/pwa/scripts/gen-voz.mjs
 *
 * edge-tts llama al servicio online de Microsoft (requiere red). Por eso los
 * mp3 generados se commitean al repo — este script es solo la herramienta de
 * regeneración, no corre en CI.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const PWA_ROOT = join(__dirname, '..');
const I18N_FILE = join(PWA_ROOT, 'src/lib/i18n.svelte.ts');
const OUT_DIR = join(PWA_ROOT, 'public/voz-firma');
const MANIFEST_FILE = join(OUT_DIR, 'manifest.json');

// Específico de esta máquina de desarrollo — override con EDGE_TTS_BIN si el
// binario vive en otra ruta (otro dev, CI de regeneración, etc).
const EDGE_TTS_BIN =
  process.env.EDGE_TTS_BIN ?? 'C:/Dev/MoneyPrinterTurbo/.venv/Scripts/edge-tts.exe';
const VOICE = 'es-EC-AndreaNeural';
const I18N_PREFIX = 'guided.voz.';
const HASH_LENGTH = 16; // sha256 hex truncado — suficiente para detectar desincronización copy↔audio

// Normalización opcional: mono, ~48kbps, loudnorm. Requiere ffmpeg en PATH
// (o junto a edge-tts, en .venv/Scripts). Si no está disponible, se deja el
// mp3 de edge-tts tal cual — sigue siendo funcional.
const FFMPEG_BIN = process.env.FFMPEG_BIN ?? 'ffmpeg';

/** Extrae las claves `guided.voz.*` → texto ES desde el bloque `es:` de i18n.svelte.ts. */
function parseVozKeys(source) {
  const esBlockMatch = source.match(/\bes:\s*\{([\s\S]*?)\n {2}\},\n {2}en:/);
  if (!esBlockMatch) {
    throw new Error(
      "No se pudo localizar el bloque 'es: { ... }, en:' en i18n.svelte.ts — el parser regex necesita revisión.",
    );
  }
  const esBlock = esBlockMatch[1];

  // Cada entrada: 'guided.voz.<key>':  'texto...'  o  "texto..." (con posibles
  // saltos de línea entre la clave y el string, y comillas simples escapadas).
  const entryRe = /'guided\.voz\.([a-z0-9_]+)':\s*\n?\s*(['"])([\s\S]*?)\2,/g;
  const entries = new Map();
  let m;
  while ((m = entryRe.exec(esBlock)) !== null) {
    const [, key, , rawText] = m;
    const text = unescapeJsString(rawText);
    entries.set(key, text);
  }
  if (entries.size === 0) {
    throw new Error("No se encontraron claves 'guided.voz.*' en el bloque es de i18n.svelte.ts.");
  }
  return entries;
}

function unescapeJsString(raw) {
  return raw.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n');
}

function hashText(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, HASH_LENGTH);
}

async function ffmpegAvailable() {
  try {
    await execFileAsync(FFMPEG_BIN, ['-version']);
    return true;
  } catch {
    return false;
  }
}

async function synthesize(text, outFile) {
  await execFileAsync(EDGE_TTS_BIN, ['--voice', VOICE, '--text', text, '--write-media', outFile]);
}

async function normalizeInPlace(file) {
  const tmp = `${file}.tmp.mp3`;
  await execFileAsync(FFMPEG_BIN, [
    '-y',
    '-i',
    file,
    '-ac',
    '1',
    '-b:a',
    '48k',
    '-af',
    'loudnorm',
    tmp,
  ]);
  const { rename } = await import('node:fs/promises');
  await rename(tmp, file);
}

async function main() {
  const source = await readFile(I18N_FILE, 'utf8');
  const entries = parseVozKeys(source);

  await mkdir(OUT_DIR, { recursive: true });

  const hasFfmpeg = await ffmpegAvailable();
  console.log(
    `[gen-voz] ${entries.size} claves guided.voz.* encontradas. Normalización ffmpeg: ${
      hasFfmpeg ? 'activada' : 'DESACTIVADA (no encontrado, se deja el mp3 tal cual)'
    }.`,
  );

  const manifest = {};
  let totalBytes = 0;

  for (const [key, text] of entries) {
    const hash = hashText(text);
    const file = `${key}.mp3`;
    const outPath = join(OUT_DIR, file);

    console.log(`[gen-voz] Sintetizando "${key}" (${text.length} chars)...`);
    await synthesize(text, outPath);

    if (hasFfmpeg) {
      try {
        await normalizeInPlace(outPath);
      } catch (err) {
        console.warn(`[gen-voz] normalización ffmpeg falló para "${key}", se deja sin normalizar: ${err.message}`);
      }
    }

    const { size } = await stat(outPath);
    if (size === 0) {
      throw new Error(`[gen-voz] "${key}" generó un mp3 vacío (${outPath}).`);
    }
    totalBytes += size;
    manifest[key] = { file, hash };
    console.log(`[gen-voz]   -> ${file} (${(size / 1024).toFixed(1)} KB, hash ${hash})`);
  }

  await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(
    `[gen-voz] Listo: ${entries.size} clips, ${(totalBytes / 1024 / 1024).toFixed(2)} MB totales. Manifest: ${MANIFEST_FILE}`,
  );
}

main().catch((err) => {
  console.error('[gen-voz] ERROR:', err);
  process.exitCode = 1;
});
