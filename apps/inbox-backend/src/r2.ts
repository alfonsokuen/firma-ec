import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { logger } from './logger.js';

/**
 * Cloudflare R2 client for encrypted PDF storage.
 *
 * KNOWN TRAP (memory: feedback_aws_sdk_s3_flexible_checksums_r2):
 *   aws-sdk-s3 ≥ 1.196 introduced "flexible checksums" that break R2
 *   multipart uploads > 1MB silently (HTTP 422). We MUST set
 *   AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED to opt-out.
 *
 * We set this both via env and via constructor option (defense-in-depth).
 */

// Hoisted at import time so any subsequent SDK init sees it.
if (process.env['AWS_REQUEST_CHECKSUM_CALCULATION'] === undefined) {
  process.env['AWS_REQUEST_CHECKSUM_CALCULATION'] = 'WHEN_REQUIRED';
}

export interface R2Config {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly endpoint: string;
}

export interface R2Handle {
  readonly client: S3Client;
  readonly bucket: string;
}

let _r2: R2Handle | undefined;

export function buildR2(cfg: R2Config): R2Handle {
  const s3Config: S3ClientConfig = {
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    // Force-path style is required for R2.
    forcePathStyle: false,
    // Defense-in-depth on top of the env var above.
    requestChecksumCalculation: 'WHEN_REQUIRED',
  };

  const client = new S3Client(s3Config);
  logger.info({ bucket: cfg.bucket, endpoint: cfg.endpoint }, 'r2 client initialized');
  return { client, bucket: cfg.bucket };
}

export function getR2(): R2Handle {
  if (_r2 === undefined) {
    const accountId = process.env['R2_ACCOUNT_ID'] ?? '';
    const accessKeyId = process.env['R2_ACCESS_KEY_ID'] ?? '';
    const secretAccessKey = process.env['R2_SECRET_ACCESS_KEY'] ?? '';
    const bucket = process.env['R2_BUCKET'] ?? 'firmar-ec-inbox';
    const endpoint =
      process.env['R2_ENDPOINT'] ?? `https://${accountId}.r2.cloudflarestorage.com`;
    _r2 = buildR2({ accountId, accessKeyId, secretAccessKey, bucket, endpoint });
  }
  return _r2;
}
