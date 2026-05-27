import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import { renderOgPng } from '../../lib/og-image.ts';

// Resolve the landing app root from this file's location.
// Source: src/pages/og/[slug].png.ts → 3 levels up = apps/landing
// Built:  dist/pages/og/_slug_.astro.mjs → 3 levels up = apps/landing
const __filename = fileURLToPath(import.meta.url);
const LANDING_ROOT = join(dirname(__filename), '..', '..', '..');

// Pre-generate one OG image per content page slug at build time
export async function getStaticPaths() {
  const pages = await getCollection('pages');
  const fixed = [
    {
      slug: 'default',
      title: 'Firma y verifica PDFs con tu certificado electrónico .p12.',
      eyebrow: 'firmar.ec',
    },
    {
      slug: 'home',
      title: 'Firma y verifica PDFs con tu certificado .p12',
      eyebrow: 'firmar.ec',
      badge: 'AGPL-3.0 · LOPDP nativa',
    },
  ];
  return [
    ...fixed.map((f) => ({ params: { slug: f.slug }, props: { ...f } })),
    ...pages.map((p) => ({
      // Astro 5 glob loader: p.id = "es/acerca.md" — strip .md suffix then lang prefix
      params: { slug: p.id.replace(/\.md$/, '').replace(/^[a-z]{2}\//, '') },
      props: {
        slug: p.id,
        title: p.data.title,
        eyebrow: 'firmar.ec',
        badge: p.data.lang === 'es' ? 'Cumple LOPDP' : 'LOPDP-compliant',
      },
    })),
  ];
}

export const GET: APIRoute = async ({ props }) => {
  const { title, eyebrow, badge } = props as { title: string; eyebrow?: string; badge?: string };
  try {
    const input: { title: string; eyebrow?: string; badge?: string } = { title };
    if (eyebrow !== undefined) input.eyebrow = eyebrow;
    if (badge !== undefined) input.badge = badge;
    const png = await renderOgPng(input, LANDING_ROOT);
    return new Response(png as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    // OG generation failure must not break the build — return empty 1×1 PNG placeholder
    console.warn('[og] Failed to render OG image for slug, skipping:', err);
    // Minimal 1×1 transparent PNG (67 bytes)
    const placeholder = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
      0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8,
      0xcf, 0xc0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00,
      0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    return new Response(placeholder as unknown as BodyInit, {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  }
};
