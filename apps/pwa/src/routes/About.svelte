<script lang="ts">
  import { t, getLang } from '../lib/i18n.svelte.ts';
  const APP_VERSION = '0.2.0-dev';
</script>

<section class="container max-w-2xl mx-auto px-4 py-12">
  <h1 class="text-3xl font-display font-bold mb-4">{t('about.title')}</h1>
  <p class="text-ink-600 dark:text-ink-300 mb-6">
    {getLang() === 'es'
      ? 'firmar.ec es una PWA pública ecuatoriana de firma y verificación de PDFs, sin fines de lucro, operada por IDK Manager.'
      : 'firmar.ec is an Ecuadorian public PWA for signing and verifying PDFs, non-profit, operated by IDK Manager.'}
  </p>
  <ul class="space-y-2 text-sm">
    <li>{getLang() === 'es' ? 'Versión' : 'Version'}: <code class="font-mono text-brand-500">{APP_VERSION}</code></li>
    <li>{getLang() === 'es' ? 'Más información' : 'More info'}: <a class="text-brand-500 hover:underline" href="https://firmar.ec/acerca">firmar.ec/acerca</a></li>
    <li>{getLang() === 'es' ? 'Licencia' : 'License'}: <a class="text-brand-500 hover:underline" href="https://github.com/idkmanager/firma-ec/blob/main/LICENSE">Apache 2.0</a></li>
    <li>{getLang() === 'es' ? 'Reportar problema' : 'Report issue'}: <a class="text-brand-500 hover:underline" href="https://github.com/idkmanager/firma-ec/issues">GitHub Issues</a></li>
  </ul>
</section>
