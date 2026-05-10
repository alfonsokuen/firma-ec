/// <reference lib="webworker" />
/**
 * sw.ts — Custom Service Worker for firmar.ec PWA (v0.4.1).
 *
 * Migrated from VitePWA `generateSW` (Workbox auto) to `injectManifest` so we
 * can intercept POST /share. The OS Share Sheet posts multipart/form-data, and
 * the share_target manifest entry only delivers the file payload when a SW
 * fetch handler claims the request — server-side Caddy can't see it (browser
 * routes the POST through the SW first).
 *
 * Pipeline:
 *   1. POST /share comes in (file, title, text, url FormData fields).
 *   2. We pull `file`, validate (PDF MIME, magic byte %PDF-, size <50MB).
 *   3. Stash the bytes into the `shared-pdf-v1` Cache Storage under a UUID key.
 *   4. 303-redirect to `/#/share?pdfId=<uuid>` so the SPA handler picks it up.
 *
 * Privacy: Cache Storage is per-origin, never synced to a server. TTL 10min.
 * The handler fetches once and deletes the entry on success.
 *
 * Security:
 *   - /_assets/crypto-* and /trust/tsl-ec.{json,sha256} are NetworkOnly
 *     (stale crypto/TSL is a security risk — never serve from cache).
 *   - precacheAndRoute manages app-shell freshness via __WB_MANIFEST.
 *   - cleanupOutdatedCaches removes legacy Workbox precache entries from the
 *     pre-injectManifest deploys so users don't hold v0.4.0 shells forever.
 */

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const SHARED_CACHE = 'shared-pdf-v1';
const TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB

// Workbox's cleanupOutdatedCaches() only removes caches matching its own
// naming pattern. It does NOT touch caches from previous deploys whose
// precache manifest hashes changed but kept the same prefix. The result:
// users on Android Chrome who installed v0.7.0-rc1/rc2 saw stale chunks
// from those revisions after rc3+ shipped renamed asset hashes, breaking
// the upload zone (chunks pointed by stale HTML 404'd).
//
// Defense: on every install, enumerate ALL caches on the origin and delete
// any Workbox precache (`workbox-precache-v2-*`) that doesn't match the
// current build's expected precache name. This is more aggressive than
// cleanupOutdatedCaches() and guarantees rc4-rc5+ users self-heal on next
// SW activation without needing to clear browser data.
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST ?? []);

self.addEventListener('install', (event: ExtendableEvent) => {
  // Don't block install on cache cleanup — it runs after activation.
  event.waitUntil(
    (async () => {
      try {
        const names = await caches.keys();
        for (const name of names) {
          // Conservative: only purge Workbox precaches from prior firmar.ec
          // deploys. Keep the shared-pdf-v1 cache (used by /share handler)
          // and any caches owned by other origins (shouldn't happen, but
          // belt-and-suspenders).
          if (name.startsWith('workbox-precache-') || name.startsWith('workbox-runtime-')) {
            try { await caches.delete(name); } catch { /* noop */ }
          }
        }
      } catch { /* noop — cache API failure shouldn't block SW install */ }
    })(),
  );
});

// ── Security-critical NetworkOnly rules (parity with v0.4.0 generateSW) ────
registerRoute(
  ({ url }) => /^\/_assets\/crypto-/.test(url.pathname),
  new NetworkOnly(),
);
registerRoute(
  ({ url }) => url.pathname === '/trust/tsl-ec.json',
  new NetworkOnly(),
);
registerRoute(
  ({ url }) => url.pathname === '/trust/tsl-ec.sha256',
  new NetworkOnly(),
);

// ── Share Target POST handler ──────────────────────────────────────────────
self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);
  if (url.pathname === '/share' && event.request.method === 'POST') {
    event.respondWith(handleShare(event.request));
  }
});

async function handleShare(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return Response.redirect('/?shareError=no_file', 303);
    }

    const lowerName = (file.name || '').toLowerCase();
    if (file.type !== 'application/pdf' && !lowerName.endsWith('.pdf')) {
      return Response.redirect('/?shareError=not_pdf', 303);
    }

    if (file.size > MAX_PDF_BYTES) {
      return Response.redirect('/?shareError=too_big', 303);
    }

    const arrayBuf = await file.arrayBuffer();
    if (arrayBuf.byteLength < 5) {
      return Response.redirect('/?shareError=invalid_pdf', 303);
    }
    const view = new Uint8Array(arrayBuf, 0, 5);
    const magic = String.fromCharCode(view[0]!, view[1]!, view[2]!, view[3]!, view[4]!);
    if (magic !== '%PDF-') {
      return Response.redirect('/?shareError=invalid_pdf', 303);
    }

    const cache = await caches.open(SHARED_CACHE);
    const id = crypto.randomUUID();
    const blob = new Blob([arrayBuf], { type: 'application/pdf' });
    const cacheRequest = new Request(`/__shared-pdf__/${id}`);
    const cacheResponse = new Response(blob, {
      headers: {
        'Content-Type': 'application/pdf',
        'X-Filename': encodeURIComponent(file.name || 'shared.pdf'),
        'X-Stored-At': Date.now().toString(),
      },
    });
    await cache.put(cacheRequest, cacheResponse);

    // Best-effort cleanup of old entries — fire-and-forget.
    cleanupSharedCache(cache).catch(() => {
      /* ignore cleanup errors */
    });

    // svelte-spa-router uses hash routing; the SPA shell at "/" reads pdfId.
    return Response.redirect(`/#/share?pdfId=${id}`, 303);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('SW share handler error:', err);
    return Response.redirect('/?shareError=internal', 303);
  }
}

async function cleanupSharedCache(cache: Cache): Promise<void> {
  const keys = await cache.keys();
  const now = Date.now();
  await Promise.all(
    keys.map(async (key) => {
      const resp = await cache.match(key);
      if (!resp) return;
      const storedAt = parseInt(resp.headers.get('X-Stored-At') || '0', 10);
      if (!storedAt || now - storedAt > TTL_MS) {
        await cache.delete(key);
      }
    }),
  );
}

self.addEventListener('install', () => {
  // Take over immediately on install — combined with the earlier install
  // handler that purges legacy workbox caches, this ensures rc4+ users
  // self-heal in a single page reload without manual cache clear.
  self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});
