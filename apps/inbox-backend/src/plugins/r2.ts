import { S3Client } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

// CRITICAL: opt-out of flexible checksums for R2 (memoria r2-checksum trap).
// Setting via env *and* SDK option (defense-in-depth).
if (process.env['AWS_REQUEST_CHECKSUM_CALCULATION'] === undefined) {
  process.env['AWS_REQUEST_CHECKSUM_CALCULATION'] = 'WHEN_REQUIRED';
}

declare module 'fastify' {
  interface FastifyInstance {
    r2: { client: S3Client; bucket: string };
  }
}

export interface R2PluginOpts {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Override (e.g. mock client) for tests. */
  client?: S3Client;
}

export default fp<R2PluginOpts>(
  async function r2Plugin(app: FastifyInstance, opts) {
    const client =
      opts.client ??
      new S3Client({
        region: 'auto',
        endpoint: opts.endpoint,
        credentials: {
          accessKeyId: opts.accessKeyId,
          secretAccessKey: opts.secretAccessKey,
        },
        forcePathStyle: true,
        requestChecksumCalculation: 'WHEN_REQUIRED',
      });

    app.decorate('r2', { client, bucket: opts.bucket });
    app.addHook('onClose', async () => {
      client.destroy();
    });
  },
  { name: 'r2' },
);
