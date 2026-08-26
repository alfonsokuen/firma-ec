/**
 * API key authentication.
 *
 * Registered on `onRequest`, which is the point of the whole design: it runs
 * BEFORE Fastify parses the body. An unauthenticated caller therefore never
 * makes us buffer their 20MB upload — rejecting them costs a header read.
 * Authenticating after the body parse would leave the cheapest denial-of-
 * service vector wide open to anyone with curl.
 *
 * Every failure answers the SAME 401 with the same body. Distinguishing
 * "unknown key" from "revoked key" from "bad secret" would turn the endpoint
 * into an oracle; the distinction goes to the log, where only we can read it.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { parseApiKey, verifySecret } from '../lib/apiKey.js';
import { type ApiKeyRecord, type KeyStore, isUsable } from '../lib/keyStore.js';

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: ApiKeyRecord;
  }
}

export interface AuthPluginOpts {
  store: KeyStore;
  pepper: string;
  /** Paths served without a key (probes). Compared exactly, never by prefix. */
  publicPaths?: string[];
}

const DEFAULT_PUBLIC_PATHS = ['/livez', '/healthz'];

function unauthorized(reply: FastifyReply): FastifyReply {
  // WWW-Authenticate tells a well-behaved client HOW to authenticate without
  // telling an attacker anything about which part they got wrong.
  return reply
    .code(401)
    .header('WWW-Authenticate', 'Bearer realm="verify-api"')
    .send({ error: 'unauthorized' });
}

async function authPlugin(app: FastifyInstance, opts: AuthPluginOpts): Promise<void> {
  const publicPaths = new Set(opts.publicPaths ?? DEFAULT_PUBLIC_PATHS);

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // `req.url` carries the query string; authorise on the path alone so
    // `/livez?x=1` cannot be used to slip past a route that needs a key.
    const path = req.url.split('?')[0] ?? req.url;
    if (publicPaths.has(path)) return;

    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      req.log.warn({ reason: 'missing_bearer' }, 'auth rejected');
      return unauthorized(reply);
    }

    const parsed = parseApiKey(header.slice('Bearer '.length).trim());
    if (parsed === null) {
      // Malformed token: rejected without touching the store at all.
      req.log.warn({ reason: 'malformed_token' }, 'auth rejected');
      return unauthorized(reply);
    }

    const record = await opts.store.findByKeyId(parsed.keyId);
    if (record === null) {
      req.log.warn({ reason: 'unknown_key', keyId: parsed.keyId }, 'auth rejected');
      return unauthorized(reply);
    }
    if (!isUsable(record, new Date())) {
      req.log.warn({ reason: 'key_not_usable', keyId: parsed.keyId }, 'auth rejected');
      return unauthorized(reply);
    }
    if (!verifySecret(parsed.secret, record.secretHash, opts.pepper)) {
      req.log.warn({ reason: 'bad_secret', keyId: parsed.keyId }, 'auth rejected');
      return unauthorized(reply);
    }

    req.apiKey = record;
  });
}

export default fp(authPlugin, { name: 'auth' });
