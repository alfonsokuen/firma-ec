/**
 * preview-proxy.mjs — dev-only single-origin bridge for the local stats preview.
 *
 * `astro dev` (4399) serves the site; `wrangler dev` (8787) serves /api/stats*.
 * The browser needs both on ONE origin (no CORS) and Astro 5 dev ignores
 * vite proxy / middleware for non-route paths — so this tiny reverse proxy
 * fronts both: /api/* → worker, everything else (incl. HMR websocket) → Astro.
 * Throwaway: not used in prod (Caddy + the edge Worker serve those paths).
 */
import http from 'node:http';

// astro dev often binds IPv6 (::1) while wrangler binds IPv4 (127.0.0.1); the
// hosts are configurable so the proxy reaches each on the right stack.
const LANDING = { host: process.env.LANDING_HOST || '127.0.0.1', port: Number(process.env.LANDING_PORT) || 4399 };
const API = { host: process.env.API_HOST || '127.0.0.1', port: Number(process.env.API_PORT) || 8787 };
const LISTEN = Number(process.env.PREVIEW_PORT) || 4500;

const upstreamFor = (url) => (url.startsWith('/api/') ? API : LANDING);

const server = http.createServer((req, res) => {
  const t = upstreamFor(req.url);
  const proxied = http.request(
    { host: t.host, port: t.port, path: req.url, method: req.method, headers: req.headers },
    (pr) => {
      res.writeHead(pr.statusCode || 502, pr.headers);
      pr.pipe(res);
    },
  );
  proxied.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`preview-proxy upstream error: ${e.message}`);
  });
  req.pipe(proxied);
});

// Forward Vite HMR websocket to Astro so live-reload keeps working.
server.on('upgrade', (req, socket, head) => {
  const proxied = http.request({
    host: LANDING.host,
    port: LANDING.port,
    path: req.url,
    method: req.method,
    headers: req.headers,
  });
  proxied.on('upgrade', (pr, psocket, phead) => {
    const lines = Object.entries(pr.headers).map(([k, v]) => `${k}: ${v}`);
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join('\r\n')}\r\n\r\n`);
    if (head?.length) psocket.write(head);
    if (phead?.length) socket.write(phead);
    psocket.pipe(socket);
    socket.pipe(psocket);
  });
  proxied.on('error', () => socket.destroy());
  proxied.end();
});

server.listen(LISTEN, '127.0.0.1', () => {
  console.log(`preview-proxy → http://localhost:${LISTEN}  (api:${API.port} landing:${LANDING.port})`);
});
