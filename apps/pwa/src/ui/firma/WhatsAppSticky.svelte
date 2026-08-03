<script lang="ts">
/**
 * WhatsAppSticky.svelte — modo guiado: barra de ayuda siempre visible.
 * Fija al fondo, por ENCIMA del footer del wizard (WizardShell ya es
 * `position: sticky` a su propio z-index) pero sin taparlo: se reserva un
 * padding-bottom en el propio wrapper (ver `guided.css`) para que el footer
 * de navegación no quede oculto detrás de esta barra.
 */
import { t } from '../../lib/i18n.svelte.ts';
import { WHATSAPP_URL } from '../../lib/links.ts';
</script>

<a
  class="wa-sticky"
  href={WHATSAPP_URL}
  target="_blank"
  rel="noopener"
  aria-label={t('guided.help.sticky')}
>
  <span class="i-lucide-message-circle" aria-hidden="true"></span>
  <span>{t('guided.help.sticky')}</span>
</a>

<style>
  .wa-sticky {
    /* Esquina inferior-izquierda: el CTA primario del footer (Siguiente/
       Firmar) vive a la derecha del grid de WizardShell — nunca se solapan.
       `guided.css` reserva padding-bottom en el scope guiado para que este
       chip flotante tampoco tape el footer en viewports cortos. */
    position: fixed;
    left: max(1rem, env(safe-area-inset-left));
    bottom: max(1rem, env(safe-area-inset-bottom));
    z-index: 40;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    min-height: 48px;
    border-radius: 999px;
    /* AAA a11y (F3b): oklch(64% ...) con texto blanco medía 3.13:1 con
       axe-core color-contrast (necesita 4.5:1). Oscurecido a 38% L. */
    background: oklch(38% 0.14 155);
    color: white;
    font-weight: 600;
    font-size: 0.9375rem;
    text-decoration: none;
    box-shadow: 0 4px 16px oklch(20% 0.04 250 / 0.25);
    white-space: nowrap;
  }
  .wa-sticky:hover,
  .wa-sticky:focus-visible {
    background: oklch(33% 0.14 155);
  }
</style>
