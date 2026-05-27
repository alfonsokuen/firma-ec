<script lang="ts">
/**
 * Footer.svelte — visual parity with `apps/landing/src/components/Footer.astro`.
 *
 * Layout: 3-col grid (lockup+desc+IDK / project links / privacy column) +
 * bottom strip with copyright + version + security.txt link. Mirrors landing
 * border treatments + container widths.
 *
 * Privacy claim ("No tracking. No servers.") stays — it's a meaningful
 * PWA-specific statement that the landing intentionally lacks. It just lives
 * inside the structured layout instead of floating in a single row.
 *
 * a11y: <footer> implies role="contentinfo" — no extra ARIA needed.
 */
import { link } from 'svelte-spa-router';
import { t } from '../lib/i18n.svelte.ts';
import { APP_VERSION } from '../lib/version.ts';
import IdkmanagerMark from './IdkmanagerMark.svelte';

const year = new Date().getFullYear();
</script>

<footer class="border-t border-ink-200 dark:border-ink-800 mt-16">
  <div class="container max-w-6xl mx-auto px-4 py-10 grid gap-8 md:grid-cols-3">
    <!-- Lockup + description + IDKMANAGER credit -->
    <div>
      <p class="font-display text-base font-bold tracking-tight">
        <span class="text-brand-500">firmar</span><span class="text-ink-500">.ec</span>
        <span class="ml-1 text-[10px] font-mono text-ink-500 dark:text-ink-400 bg-ink-100 dark:bg-ink-800 px-1.5 py-0.5 rounded">app</span>
      </p>
      <p class="mt-3 text-sm text-ink-600 dark:text-ink-400 max-w-prose">
        {t('footer.description')}
      </p>
      <p class="mt-3 text-xs text-ink-500 flex items-center flex-wrap gap-x-2 gap-y-1">
        <span>{t('footer.operated_by')}</span>
        <a
          class="inline-flex items-center gap-1.5 text-ink-700 dark:text-ink-300 hover:text-brand-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 dark:focus-visible:ring-offset-ink-950 rounded"
          href="https://idkmanager.com/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="IDKMANAGER — idkmanager.com"
        >
          <IdkmanagerMark size="sm" />
          <span class="i-lucide-arrow-up-right text-xs opacity-60" aria-hidden="true"></span>
        </a>
      </p>
    </div>

    <!-- Project links -->
    <div>
      <h3 class="font-display text-sm font-semibold mb-3">{t('footer.project')}</h3>
      <ul class="space-y-1 text-sm text-ink-600 dark:text-ink-400">
        <li>
          <a
            href="/about"
            use:link
            class="inline-flex items-center min-h-11 hover:text-ink-900 dark:hover:text-ink-50"
          >
            {t('footer.about_link')}
          </a>
        </li>
        <li>
          <a
            href="https://firmar.ec/"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 min-h-11 hover:text-ink-900 dark:hover:text-ink-50"
          >
            <span>{t('footer.institutional')}</span>
            <span class="i-lucide-arrow-up-right text-xs opacity-60" aria-hidden="true"></span>
          </a>
        </li>
        <li>
          <a
            href="https://github.com/idkmanager/firmar-ec"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 min-h-11 hover:text-ink-900 dark:hover:text-ink-50 font-mono text-xs"
          >
            <span class="i-lucide-github text-base" aria-hidden="true"></span>
            <span>github.com/idkmanager</span>
          </a>
        </li>
      </ul>
    </div>

    <!-- Privacy claim (PWA-specific differentiator, kept intact) -->
    <div>
      <h3 class="font-display text-sm font-semibold mb-3">{t('footer.privacy_heading')}</h3>
      <p class="text-sm text-ink-600 dark:text-ink-400 leading-relaxed flex items-start gap-2">
        <span class="i-lucide-shield-check text-ok-500 text-base mt-0.5 flex-shrink-0" aria-hidden="true"></span>
        <span>{t('footer.privacy_claim')}</span>
      </p>
    </div>
  </div>

  <!-- Bottom strip — landing parity -->
  <div class="border-t border-ink-200 dark:border-ink-800">
    <div class="container max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 py-4 text-xs text-ink-500">
      <p class="flex items-center flex-wrap gap-x-2 gap-y-1">
        <span>© {year} firmar.ec · {t('footer.licencia')}</span>
        <span class="hidden sm:inline text-ink-400 dark:text-ink-600" aria-hidden="true">·</span>
        <span class="font-mono">
          {t('footer.version_label')} <span class="text-brand-500">{APP_VERSION}</span>
        </span>
      </p>
      <p>
        <a
          href="https://firmar.ec/.well-known/security.txt"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-ink-700 dark:hover:text-ink-300"
        >security.txt</a>
      </p>
    </div>
  </div>
</footer>
