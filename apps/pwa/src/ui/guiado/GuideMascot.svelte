<script lang="ts">
/**
 * GuideMascot.svelte — avatar cálido "Fe" del modo guiado (F3 pulido).
 *
 * Coherencia de marca con el patrón "Fe" de tienda.firmar.ec
 * (ChatWidget.svelte: mismo nombre, mismo tono cálido). Aquí es un avatar
 * SVG inline + burbuja de texto — NO un asistente de chat (firmar.ec es
 * no-tracking / sin backend de IA; fuera de alcance). Puramente decorativo:
 * el SVG lleva `aria-hidden`, el único contenido anunciado es el mensaje.
 */
interface Props {
  /** Texto de la burbuja — SIEMPRE una clave i18n resuelta por el caller. */
  message: string;
  /** Variante discreta (menos protagonismo) para la pantalla final (paso 6). */
  compact?: boolean;
}

const { message, compact = false }: Props = $props();
</script>

<div class="guide-mascot" class:compact>
  <span class="mascot-avatar" aria-hidden="true">
    <svg viewBox="0 0 48 48" role="img" focusable="false">
      <circle cx="24" cy="24" r="23" fill="var(--brand-500)" />
      <circle cx="24" cy="20" r="8" fill="white" />
      <path d="M10 40c1.5-8 7-12 14-12s12.5 4 14 12" fill="white" />
    </svg>
  </span>
  <p class="mascot-bubble">{message}</p>
</div>

<style>
  .guide-mascot {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    text-align: left;
  }
  .guide-mascot.compact {
    gap: 0.5rem;
    opacity: 0.92;
  }
  .mascot-avatar {
    flex: none;
    width: 3rem;
    height: 3rem;
    border-radius: 50%;
    overflow: hidden;
    box-shadow: 0 2px 8px -2px rgba(0, 0, 0, 0.25);
  }
  .compact .mascot-avatar {
    width: 2.25rem;
    height: 2.25rem;
  }
  .mascot-avatar svg {
    width: 100%;
    height: 100%;
    display: block;
  }
  .mascot-bubble {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding: 0.6rem 0.9rem;
    border-radius: var(--r-lg, 12px);
    background: var(--ink-50, oklch(97% 0 0));
    border: 1px solid var(--ink-200, oklch(90% 0 0));
    font-size: 0.95rem;
    line-height: 1.4;
    color: var(--ink-700, oklch(30% 0 0));
  }
  :global([data-theme='dark']) .mascot-bubble {
    background: var(--ink-900, oklch(20% 0 0));
    border-color: var(--ink-700, oklch(35% 0 0));
    color: var(--ink-200, oklch(85% 0 0));
  }
</style>
