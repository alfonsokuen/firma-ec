/**
 * Where API keys live.
 *
 * The beta seeds keys from the secret manager at boot, which is why there is no
 * database here yet: with a handful of pilot clients, a Postgres dependency
 * buys nothing that a signed config does not already give us. The interface
 * exists because the self-service story (issue/rotate/revoke from a dashboard)
 * will need a real store, and every call site should already be written against
 * the seam rather than a global.
 *
 * Whatever backs it later must keep two properties:
 *  - lookup is O(1) on `keyId` (never scan-and-hash);
 *  - only the HMAC is persisted, never the secret.
 */
import { z } from 'zod';

export const apiKeyRecordSchema = z.object({
  keyId: z.string().min(1),
  /** HMAC-SHA256 of the secret half under the pepper. */
  secretHash: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['active', 'revoked']).default('active'),
  /** ISO-8601; absent means no expiry. */
  expiresAt: z.string().datetime().optional(),
  /**
   * Defaults are the FREE tier, and a free tier exists to prove the API works
   * — not to run someone's production on our CPU. 50/day is enough to evaluate
   * and to build an integration against; a real workload hits it the first day
   * and has to talk to us, which is the point.
   */
  quotaPerMinute: z.number().int().positive().default(3),
  quotaPerDay: z.number().int().positive().default(50),
  /**
   * Simultaneous verifications. A per-minute bucket alone does NOT bound CPU,
   * so this is the number that actually protects the machine.
   *
   * ONE, not two: the service runs two worker threads, so a default of 2 let a
   * single free key occupy every worker at once and starve every other caller.
   * A paid record raises this explicitly.
   */
  maxConcurrent: z.number().int().positive().default(1),
});

export type ApiKeyRecord = z.infer<typeof apiKeyRecordSchema>;

export interface KeyStore {
  findByKeyId(keyId: string): Promise<ApiKeyRecord | null>;
}

export class InMemoryKeyStore implements KeyStore {
  private readonly byId: Map<string, ApiKeyRecord>;

  constructor(records: ApiKeyRecord[]) {
    this.byId = new Map(records.map((r) => [r.keyId, r]));
  }

  async findByKeyId(keyId: string): Promise<ApiKeyRecord | null> {
    return this.byId.get(keyId) ?? null;
  }
}

/**
 * Parse the seeded key set.
 *
 * Fails CLOSED on malformed input: a typo in the secret must not silently
 * produce a service that accepts nobody (or, worse, that we then "fix" by
 * loosening the check).
 */
export function parseKeySeed(raw: string): ApiKeyRecord[] {
  if (raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('API_KEYS is not valid JSON');
  }
  const result = z.array(apiKeyRecordSchema).safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `API_KEYS is malformed: ${result.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return result.data;
}

/** Whether a key may be used right now. */
export function isUsable(record: ApiKeyRecord, now: Date): boolean {
  if (record.status !== 'active') return false;
  if (record.expiresAt !== undefined && new Date(record.expiresAt) <= now) return false;
  return true;
}
