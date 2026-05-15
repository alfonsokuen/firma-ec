/**
 * Map-backed S3Client mock — records every PutObject body, supports Get/Head/Delete.
 *
 * Privacy invariants assert against `storage` (the raw bytes any cloud
 * storage would persist) and `puts` (a chronological log).
 */
import type { S3Client } from '@aws-sdk/client-s3';

export interface PutLogEntry {
  bucket: string;
  key: string;
  body: Buffer;
  contentType?: string;
}

export interface MemoryS3Handle {
  client: S3Client;
  storage: Map<string, Buffer>;
  puts: PutLogEntry[];
  deleted: string[];
  /** Toggle to false to simulate HeadBucket failure (health probe). */
  headOk: boolean;
  /** When set, every send() throws this error (covers "R2 down"). */
  failureMode?: 'put' | 'get' | 'head' | 'all';
}

export function buildMemoryS3(): MemoryS3Handle {
  const handle: MemoryS3Handle = {
    storage: new Map<string, Buffer>(),
    puts: [],
    deleted: [],
    headOk: true,
    client: {} as S3Client,
  };

  handle.client = {
    send: async (cmd: {
      constructor: { name: string };
      input: { Bucket: string; Key: string; Body?: Buffer | Uint8Array; ContentType?: string };
    }) => {
      const cls = cmd.constructor.name;
      if (handle.failureMode === 'all') throw new Error('s3 down');
      if (cls === 'PutObjectCommand') {
        if (handle.failureMode === 'put') throw new Error('put failed');
        const body = cmd.input.Body;
        if (!body) throw new Error('PutObjectCommand: missing body');
        const buf = Buffer.isBuffer(body) ? Buffer.from(body) : Buffer.from(body);
        handle.storage.set(cmd.input.Key, buf);
        handle.puts.push({
          bucket: cmd.input.Bucket,
          key: cmd.input.Key,
          body: buf,
          ...(cmd.input.ContentType !== undefined ? { contentType: cmd.input.ContentType } : {}),
        });
        return {};
      }
      if (cls === 'GetObjectCommand') {
        if (handle.failureMode === 'get') throw new Error('get failed');
        const buf = handle.storage.get(cmd.input.Key);
        if (!buf) {
          const e = new Error('not found') as Error & {
            name: string;
            $metadata: { httpStatusCode: number };
          };
          e.name = 'NoSuchKey';
          e.$metadata = { httpStatusCode: 404 };
          throw e;
        }
        return {
          Body: {
            async *[Symbol.asyncIterator]() {
              yield buf;
            },
          },
        };
      }
      if (cls === 'DeleteObjectCommand') {
        handle.deleted.push(cmd.input.Key);
        handle.storage.delete(cmd.input.Key);
        return {};
      }
      if (cls === 'HeadBucketCommand') {
        if (!handle.headOk || handle.failureMode === 'head') throw new Error('r2 head failed');
        return {};
      }
      throw new Error(`mockS3: unsupported command ${cls}`);
    },
    destroy: () => {},
  } as unknown as S3Client;

  return handle;
}
