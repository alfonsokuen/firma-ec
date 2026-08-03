/**
 * voice.svelte.ts — F2a modo guiado: motor de voz de 2 niveles.
 *
 * Nota de nombre de archivo: el plan (docs/plan-modo-guiado-firmar-facil.md §3)
 * llama a este módulo `voice.ts`, pero necesita runes (`$state`) para exponer
 * "¿está hablando?" de forma reactiva a `GuideNarrator.svelte`. En Svelte 5 los
 * runes solo funcionan en `.svelte` / `.svelte.ts` — por eso sigue la misma
 * convención que `settings.svelte.ts` en este mismo repo.
 *
 * Arquitectura (portada del patrón probado en
 * `tienda-firmar-ec/apps/storefront/src/routes/guiado/+page.svelte`):
 *   Nivel 1 — clip mp3 pre-renderizado (generado por F2b, edge-tts
 *             es-EC-AndreaNeural) servido desde `/voz-firma/<archivo>.mp3`.
 *   Nivel 2 — fallback Web Speech API (`speechSynthesis`) si no hay clip, si
 *             falla la carga/reproducción, o si el manifest no existe.
 *
 * Autoplay gate: la only manera de "desbloquear" audio es una llamada a
 * `speak()` originada por un gesto real de usuario (click de un botón).
 * `speakAuto()` (narración automática al entrar a un paso) SOLO reproduce si
 * ya hubo ese gesto Y el usuario tiene `voiceAuto` activado en Settings —
 * nunca dispara audio por sí sola, así que nunca puede producir un
 * `NotAllowedError` de autoplay.
 *
 * ## Schema del manifest — contrato con F2b (generador de clips)
 *
 * `GET /voz-firma/manifest.json`:
 * ```json
 * {
 *   "cargar_pdf": { "file": "cargar_pdf.mp3", "hash": "<hash del texto i18n>" },
 *   "ubicar_firma": { "file": "ubicar_firma.mp3", "hash": "..." }
 * }
 * ```
 * - Clave = el `voiceKey` corto usado en `speak(voiceKey)` (SIN el prefijo
 *   `guided.voz.`), p.ej. `"cargar_pdf"`.
 * - `file` = nombre de archivo dentro de `/voz-firma/` (Vite sirve `public/`).
 * - `hash` = hash del texto i18n `guided.voz.<voiceKey>` en el momento de
 *   generar el clip. Este módulo NO valida el hash todavía (F2b decide cómo
 *   invalidar); se documenta aquí para que el generador lo escriba desde ya.
 * - Si el manifest no existe (404) o el fetch falla, el motor cae a Web
 *   Speech para TODAS las claves sin romper nada (modo solo-TTS).
 */
import { type Lang, type UIKey, getLang, t } from '../i18n.svelte.ts';
import { getSettings } from '../settings.svelte.ts';

const VOICE_BASE = '/voz-firma';
const MANIFEST_URL = `${VOICE_BASE}/manifest.json`;
const I18N_PREFIX = 'guided.voz.';

export interface VoiceManifestEntry {
  file: string;
  hash: string;
}
export type VoiceManifest = Record<string, VoiceManifestEntry>;

/** Clave corta (`"cargar_pdf"`) → clave i18n (`"guided.voz.cargar_pdf"`). */
export function voiceKeyToI18n(key: string): UIKey {
  return `${I18N_PREFIX}${key}` as UIKey;
}

// ── Manifest (fetch una vez, cacheado en memoria de módulo) ────────────
let manifestPromise: Promise<VoiceManifest | null> | null = null;
/** Evita spamear la consola: el manifest se pide una sola vez por sesión. */
let manifestWarnLogged = false;

/**
 * Fix C (revisión F2): antes esto degradaba a Web Speech en silencio total.
 * firmar.ec es no-tracking, así que el rastro se queda en `console.warn`
 * (nunca telemetría/analytics/envío a servidor) y solo se emite una vez.
 */
function warnManifestFailedOnce(): void {
  if (manifestWarnLogged) return;
  manifestWarnLogged = true;
  console.warn(
    '[voice] No se pudo cargar el manifest de voz (/voz-firma/manifest.json); se usará Web Speech API como fallback.',
  );
}

function loadManifest(): Promise<VoiceManifest | null> {
  if (manifestPromise) return manifestPromise;
  if (typeof fetch === 'undefined') {
    manifestPromise = Promise.resolve(null);
    return manifestPromise;
  }
  manifestPromise = fetch(MANIFEST_URL)
    .then((res) => {
      if (res.ok) return res.json() as Promise<VoiceManifest>;
      warnManifestFailedOnce();
      return null;
    })
    .then((data) => (data && typeof data === 'object' ? data : null))
    .catch(() => {
      warnManifestFailedOnce();
      return null;
    });
  return manifestPromise;
}

async function resolveClipUrl(key: string): Promise<string | null> {
  const manifest = await loadManifest();
  const entry = manifest?.[key];
  if (!entry || typeof entry.file !== 'string' || entry.file.length === 0) return null;
  // Cache-bust por el hash del texto: los .mp3 tienen nombre estable, así que
  // Cloudflare (y el SW/navegador) cachean por URL y servirían el clip VIEJO
  // tras regenerar la voz. Colgar `?v=<hash>` del manifest hace que un cambio
  // de texto cambie la URL → se trae el clip nuevo sin purgar caché a mano.
  // `url.pathname` sigue siendo `/voz-firma/<file>.mp3` (la query no cuenta),
  // así que la regla runtime-cache de `sw.ts` sigue matcheando.
  const bust = typeof entry.hash === 'string' && entry.hash.length > 0 ? `?v=${entry.hash}` : '';
  return `${VOICE_BASE}/${entry.file}${bust}`;
}

// ── Estado reactivo ──────────────────────────────────────────────────
let speaking = $state(false);
/** true tras el primer `speak()` disparado por un gesto real de usuario. */
let audioUnlocked = false;

/**
 * Guard de generación anti-doble-voz.
 *
 * Bug que resuelve: `await el.play()` resuelve en cuanto el clip EMPIEZA a
 * sonar, no cuando termina. Si mientras tanto llega una segunda `speak()`
 * (p.ej. `bienvenida` seguida de inmediato por `speakAuto('cargar_pdf')` al
 * montar el paso 1), esa segunda llamada hace `stop()` → `audioEl.pause()`,
 * lo que RECHAZA la promesa `play()` de la primera con `AbortError` → su
 * `catch` caía a `ttsFallback(...)` del PRIMER texto, sonando a la vez que
 * el clip/TTS de la segunda. Dos voces simultáneas.
 *
 * Cada `stop()` incrementa `playGeneration`; cada `speak()` reclama la
 * generación más nueva al arrancar. Si al volver de un `await` la
 * generación reclamada ya no es la vigente, esa llamada fue superada por
 * otra más reciente y debe salir en silencio (nunca hacer fallback).
 */
let playGeneration = 0;

let audioEl: HTMLAudioElement | null = null;
function getAudioEl(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = 'none';
    audioEl.addEventListener('ended', () => {
      speaking = false;
    });
    audioEl.addEventListener('error', () => {
      speaking = false;
    });
  }
  return audioEl;
}

/** BCP-47 tag usado por Web Speech para cada idioma de la app. */
const TTS_LANG_TAG: Record<Lang, string> = {
  es: 'es-419',
  en: 'en-US',
};

/** Nombres típicos de voces femeninas por idioma (heurística, best-effort). */
const FEMALE_NAME_HINTS: Record<Lang, RegExp> = {
  es: /paulina|m[oó]nica|sabina|helena|laura|female|mujer|elena|esperanza|andrea/i,
  en: /samantha|susan|karen|victoria|zira|female|aria|jenny|joanna|salli/i,
};

/**
 * Elige una voz femenina para `lang` si el navegador la ofrece; si no hay
 * ninguna que coincida con el nombre, cae a la primera voz de ese idioma.
 */
export function pickVoiceForLang(lang: Lang): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  const female = matching.find((v) => FEMALE_NAME_HINTS[lang].test(v.name));
  return female ?? matching[0] ?? null;
}

/** @deprecated usa `pickVoiceForLang('es')`. Se mantiene por compatibilidad. */
export function pickSpanishFemaleVoice(): SpeechSynthesisVoice | null {
  return pickVoiceForLang('es');
}

function ttsFallback(text: string, lang: Lang): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = TTS_LANG_TAG[lang];
  u.rate = 0.95;
  const v = pickVoiceForLang(lang);
  if (v !== null) u.voice = v;
  u.onend = () => {
    speaking = false;
  };
  u.onerror = () => {
    speaking = false;
  };
  speaking = true;
  window.speechSynthesis.speak(u);
}

/** Detiene cualquier reproducción en curso (clip o TTS). Idempotente. */
export function stop(): void {
  playGeneration++;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  if (audioEl) audioEl.pause();
  speaking = false;
}

/** true mientras se reproduce un clip o una narración TTS. Reactivo. */
export function isSpeaking(): boolean {
  return speaking;
}

/**
 * Reproduce la narración de `voiceKey`. SIEMPRE originada por un gesto real
 * de usuario (click) — es lo que desbloquea el autoplay policy. Intenta el
 * clip pre-renderizado primero; si no hay manifest, no hay entrada para esa
 * clave, o `play()` falla (autoplay bloqueado / red / 404), cae a Web Speech.
 */
export async function speak(key: string): Promise<void> {
  stop();
  const myGen = ++playGeneration;
  audioUnlocked = true;
  const lang = getLang();
  // Los clips mp3 pre-renderizados SOLO existen en español (F2b, edge-tts
  // es-EC-AndreaNeural). En inglés no tiene sentido pedir el manifest ni
  // intentar reproducir un clip que narraría en el idioma equivocado — se va
  // directo a Web Speech con el texto EN.
  if (lang === 'es') {
    const clipUrl = await resolveClipUrl(key);
    if (myGen !== playGeneration) return; // superado por un speak()/stop() posterior
    if (clipUrl) {
      const el = getAudioEl();
      if (el) {
        el.src = clipUrl;
        speaking = true;
        try {
          await el.play();
          return;
        } catch {
          // Si ya no somos la generación vigente, esta interrupción fue
          // causada por un stop()/speak() legítimo (p.ej. AbortError de
          // pause()) — NO es un fallo real, salir en silencio sin fallback.
          if (myGen !== playGeneration) return;
          // Seguimos vigentes: fallo real (formato/red/404) — cae a TTS sin
          // romper la experiencia.
        }
      }
    }
  }
  if (myGen !== playGeneration) return;
  ttsFallback(t(voiceKeyToI18n(key)), lang);
}

/**
 * Narración automática al entrar a un paso. NUNCA reproduce sin que ya haya
 * habido un gesto de usuario (via `speak()`) Y sin que `voiceAuto` esté
 * activado en Settings — así nunca puede violar la autoplay policy.
 */
export async function speakAuto(key: string): Promise<void> {
  if (!audioUnlocked) return;
  if (!getSettings().voiceAuto) return;
  await speak(key);
}
