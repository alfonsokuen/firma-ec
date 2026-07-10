<script lang="ts">
/**
 * GuideNarrator.svelte — F2a modo guiado: narración por paso.
 *
 * Tira accesible con un botón grande "Escuchar" ↔ "Detener" y el texto de la
 * frase siempre visible (para quien no usa audio o tiene el sonido apagado).
 * El botón es el ÚNICO gesto que desbloquea el autoplay (ver
 * `lib/guiado/voice.svelte.ts`); `autoOnMount` solo narra si ya hubo ese
 * gesto en un paso anterior y `voiceAuto` está activado.
 */
import { onDestroy } from 'svelte';
import {
  isSpeaking,
  speak,
  speakAuto,
  stop,
  voiceKeyToI18n,
} from '../../lib/guiado/voice.svelte.ts';
import { t } from '../../lib/i18n.svelte.ts';

interface Props {
  /** Clave corta de `guided.voz.<voiceKey>`, p.ej. "cargar_pdf". */
  voiceKey: string;
  /** Si true, intenta narrar automáticamente al montar (sujeto al gate). */
  autoOnMount?: boolean;
}

const { voiceKey, autoOnMount = false }: Props = $props();

const phraseText = $derived(t(voiceKeyToI18n(voiceKey)));

function onToggle(): void {
  if (isSpeaking()) {
    stop();
  } else {
    void speak(voiceKey);
  }
}

// Fix B (revisión F2): antes solo narraba al MONTAR. Un `$effect` en vez de
// `onMount` corre también cada vez que `voiceKey` cambia de VALOR (p.ej.
// 'pin' → 'pin_error' tras un PIN incorrecto) — Svelte solo re-ejecuta el
// efecto cuando el valor leído dentro cambia, así que un re-render con la
// misma clave (cada keystroke del PIN, por ejemplo) no vuelve a disparar
// audio. La primera ejecución (al montar) se comporta igual que antes.
$effect(() => {
  const key = voiceKey;
  if (autoOnMount) void speakAuto(key);
});

onDestroy(() => {
  stop();
});
</script>

<div class="guide-narrator">
  <button
    type="button"
    class="narrator-btn"
    class:is-speaking={isSpeaking()}
    onclick={onToggle}
    aria-label={isSpeaking() ? t('guided.voice.stop') : t('guided.voice.play')}
  >
    <span class={isSpeaking() ? 'i-lucide-square' : 'i-lucide-volume-2'} aria-hidden="true"></span>
    <span>{isSpeaking() ? t('guided.voice.stop') : t('guided.voice.play')}</span>
  </button>
  <p class="narrator-text" aria-live="polite">{phraseText}</p>
</div>

<style>
  .guide-narrator {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    text-align: center;
  }
  .narrator-btn {
    min-height: 60px;
    min-width: 60px;
    padding: 0.75rem 1.5rem;
    border-radius: var(--r-lg, 12px);
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    background: var(--brand-500);
    color: white;
    border: none;
  }
  .narrator-btn:hover {
    background: var(--brand-600);
  }
  .narrator-btn.is-speaking {
    background: var(--ink-700, oklch(35% 0 0));
  }
  .narrator-text {
    font-size: 0.95rem;
    color: var(--ink-600, oklch(45% 0 0));
    max-width: 32rem;
  }
</style>
