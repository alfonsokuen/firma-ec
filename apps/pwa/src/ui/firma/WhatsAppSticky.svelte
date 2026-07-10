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
    background: oklch(64% 0.16 155);
    color: white;
    font-weight: 600;
    font-size: 0.9375rem;
    text-decoration: none;
    box-shadow: 0 4px 16px oklch(20% 0.04 250 / 0.25);
    white-space: nowrap;
  }
  .wa-sticky:hover,
  .wa-sticky:focus-visible {
    background: oklch(58% 0.16 155);
  }
</style>
