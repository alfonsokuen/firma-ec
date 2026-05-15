// OCSP CORS proxy worker.
// Accepts: POST /<ac-slug>  with body = OCSP request DER
// Returns: 200 with OCSP response body + Access-Control-Allow-Origin: https://app.firmar.ec

const RESPONDERS: Record<string, string> = {
  bce: 'http://ocsp.eci.bce.fin.ec',
  'security-data': 'http://ocsp.securitydata.net.ec',
  anfac: 'http://ocsp.anf.es',
  'uanataca-ec': 'http://ocsp.uanataca.com/public',
  lazzate: 'http://ocsp.lazzate.com',
  'eclipse-soft': 'http://ocsp.eclipsesoft.ec',
  datil: 'http://ocsp.datil.co',
};

const ALLOWED_ORIGIN = 'https://app.firmar.ec';
const MAX_REQUEST_BYTES = 4096; // OCSP requests are small (~ 200-400 bytes typically)

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
    }

    const slug = url.pathname.replace(/^\//, '').replace(/\/$/, '');
    const upstream = RESPONDERS[slug];
    if (!upstream) {
      return new Response(`Unknown AC: ${slug}`, { status: 404, headers: corsHeaders() });
    }

    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_REQUEST_BYTES) {
      return new Response('Request too large', { status: 413, headers: corsHeaders() });
    }

    // Pass through to AC OCSP responder
    const upstreamResp = await fetch(upstream, {
      method: 'POST',
      headers: { 'Content-Type': 'application/ocsp-request' },
      body: buf,
    });
    const respBody = await upstreamResp.arrayBuffer();
    return new Response(respBody, {
      status: upstreamResp.status,
      headers: {
        ...corsHeaders(),
        'Content-Type': 'application/ocsp-response',
        // Do not cache (status of revocation can change at any moment)
        'Cache-Control': 'no-store',
      },
    });
  },
};

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}
