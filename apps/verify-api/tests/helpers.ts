/**
 * Test rig: a server with one seeded API key.
 *
 * The key is minted through the REAL minting path (not a fixture string) so the
 * tests exercise the same parse/HMAC/verify code the service uses. A hand-made
 * token would let the format and the verifier drift apart silently.
 */
import type { FastifyInstance } from 'fastify';
import { type Env, loadEnv } from '../src/env.js';
import { mintApiKey } from '../src/lib/apiKey.js';
import type { ApiKeyRecord } from '../src/lib/keyStore.js';
import { type BuildServerOpts, buildServer } from '../src/server.js';

/** Long enough to satisfy the pepper strength check. Test-only value. */
export const TEST_PEPPER = 'test-pepper-'.padEnd(48, 'x');

export interface TestKey {
  token: string;
  record: ApiKeyRecord;
}

export function makeTestKey(over: Partial<ApiKeyRecord> = {}): TestKey {
  const minted = mintApiKey(TEST_PEPPER, 'test');
  return {
    token: minted.token,
    record: {
      keyId: minted.keyId,
      secretHash: minted.secretHash,
      name: 'test key',
      status: 'active',
      quotaPerMinute: 100,
      quotaPerDay: 1000,
      maxConcurrent: 10,
      ...over,
    },
  };
}

export function testEnv(over: Partial<Env> = {}): Env {
  // Worker mode is off under vitest: the worker entry only exists in the
  // bundle. The worker path itself is exercised against the built artifact by
  // the live check in scripts, not here.
  return { ...loadEnv(), API_KEY_PEPPER: TEST_PEPPER, VERIFY_IN_WORKER: false, ...over };
}

export async function buildTestServer(
  key: TestKey,
  opts: Omit<BuildServerOpts, 'env'> & { env?: Env } = {},
): Promise<FastifyInstance> {
  return buildServer({
    disableRateLimit: true,
    ...opts,
    env: opts.env ?? testEnv(),
    overrides: {
      keyStore: { findByKeyId: async (id) => (id === key.record.keyId ? key.record : null) },
      ...opts.overrides,
    },
  });
}

/** Authorization header for a test key. */
export const auth = (key: TestKey): Record<string, string> => ({
  authorization: `Bearer ${key.token}`,
});
