import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

describe('buildServer', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('exposes /healthz returning 200 OK', async () => {
    app = await buildServer({ disableRateLimit: true, skipRoutes: true });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('inbox-backend');
  });

  it('exposes /readyz returning 200', async () => {
    app = await buildServer({ disableRateLimit: true, skipRoutes: true });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
  });

  it('applies helmet security headers', async () => {
    app = await buildServer({ disableRateLimit: true, skipRoutes: true });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    // helmet sets X-DNS-Prefetch-Control, X-Frame-Options, etc.
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});
