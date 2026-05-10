#!/usr/bin/env node
/**
 * Generate stable named OG image aliases for share previews.
 *
 * Produces:
 *   apps/landing/public/og-firmar-ec.png       (1200×630)  ← landing default share card
 *   apps/pwa/public/og-app-firmar-ec.png       (1200×630)  ← PWA default share card
 *
 * Reuses the satori+resvg renderer in src/lib/og-image.ts so the visual
 * template stays in sync with `/og/{slug}.png` cards.
 *
 * Run: pnpm -F @firma-ec/landing og:aliases
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderOgPng } from '../src/lib/og-image.ts';

const __filename = fileURLToPath(import.meta.url);
const LANDING_ROOT = resolve(dirname(__filename), '..');
const PWA_PUBLIC = resolve(LANDING_ROOT, '..', 'pwa', 'public');

async function emit(targetPath, input) {
  const png = await renderOgPng(input, LANDING_ROOT);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, png);
  // eslint-disable-next-line no-console
  console.log(`[og] wrote ${targetPath} (${png.byteLength} bytes)`);
}

const targets = [
  {
    file: join(LANDING_ROOT, 'public', 'og-firmar-ec.png'),
    input: {
      title: 'Firma electrónica ecuatoriana en tu navegador',
      eyebrow: 'firmar.ec',
      badge: 'Apache 2.0 · Open Source',
    },
  },
  {
    file: join(PWA_PUBLIC, 'og-app-firmar-ec.png'),
    input: {
      title: 'Firma y verifica PDFs con tu .p12',
      eyebrow: 'app.firmar.ec',
      badge: 'PAdES B-T · 100% client-side',
    },
  },
];

for (const t of targets) {
  // eslint-disable-next-line no-await-in-loop
  await emit(t.file, t.input);
}
