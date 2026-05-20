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

import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const SHARED_CACHE = 'shared-pdf-v1';
const TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB

// Precache the app shell + all hashed chunks (worker chunks included) and let
// Workbox manage freshness. cleanupOutdatedCaches() runs at ACTIVATE time and
// is revision-aware: it removes only entries whose revision changed, never the
// active precache the controlling SW is currently serving from.
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST ?? []);

// v0.7.33 — self-heal on install. We skipWaiting() so a freshly-installed SW
// activates immediately instead of parking in `waiting` until the user taps an
// update toast. Combined with clients.claim() on activate (below) and the
// `controllerchange` reload in swUpdate.svelte.ts, this means one reload on a
// stale client is enough to take the new build, repopulate the precache, and
// restore the verify / p12 / sign worker chunks.
//
// ROOT CAUSE this replaces (mobile-hang incident, v0.7.30→v0.7.33): the prior
// install handler did an origin-scoped `caches.delete()` of every
// workbox-precache-* cache on EVERY install. With registerType:'prompt' the new
// SW stayed in `waiting`, so that purge wiped the precache the *still-controlling*
// old SW was serving from (and raced with precacheAndRoute writing the same
// origin-keyed cache). Worker chunks then 404'd (Caddy /assets/* serve-or-404)
// and the module workers silently never booted → 30s watchdog on verify, and
// "contraseña no aceptada" on sign (p12 worker chunk dead). Android stayed broken
// across reloads because each reload re-wiped the precache while the old SW kept
// control. Deleting that handler + skipWaiting fixes it. Do NOT reintroduce a
// blanket caches.delete() in install.
self.addEventListener('install', () => {
  self.skipWaiting();
});

// ── Security-critical NetworkOnly rules (parity with v0.4.0 generateSW) ────
registerRoute(({ url }) => /^\/_assets\/crypto-/.test(url.pathname), new NetworkOnly());
registerRoute(({ url }) => url.pathname === '/trust/tsl-ec.json', new NetworkOnly());
registerRoute(({ url }) => url.pathname === '/trust/tsl-ec.sha256', new NetworkOnly());

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
      const storedAt = Number.parseInt(resp.headers.get('X-Stored-At') || '0', 10);
      if (!storedAt || now - storedAt > TTL_MS) {
        await cache.delete(key);
      }
    }),
  );
}

// Since v0.7.33 the install handler skipWaiting()s, so updates self-activate and
// this message path is normally redundant. Kept as a belt-and-suspenders hook:
// if a build ever reverts to a prompt flow, the UpdateNotification toast can
// still drive activation by posting `{type:'SKIP_WAITING'}`.
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string } | null;
  if (data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});
