import { randomInt } from 'node:crypto';
import * as argon2 from 'argon2';
import { hmacHex } from '../lib/hmac.js';
import type { RedisHandle } from '../redis.js';

/** 6-digit numeric OTP (zero-padded), generated with crypto-strong randomness. */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

const ARGON2_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024, // 64 MiB
  timeCost: 3,
  parallelism: 2,
};

/**
 * Argon2id hash of `otp || pepper`. Pepper = INBOX_DEPLOY_SECRET so the hash
 * is unusable without server-side knowledge — additional defense vs leaked DB.
 */
export async function hashOtp(otp: string, pepper: string): Promise<string> {
  return argon2.hash(`${otp}::${pepper}`, ARGON2_OPTS);
}

export async function verifyOtp(otp: string, encoded: string, pepper: string): Promise<boolean> {
  try {
    return await argon2.verify(encoded, `${otp}::${pepper}`);
  } catch {
    return false;
  }
}

/**
 * Deterministic, cheap lookup token for Redis (HMAC-SHA256 of OTP with deploy
 * secret). Argon2 hash stays in DB for offline brute-force resistance; this
 * key is only valid for ~10 min in Redis.
 */
export function otpLookupKey(otp: string, deploySecret: string): string {
  return hmacHex(deploySecret, otp);
}

/** Store OTP→pdfId mapping in Redis with TTL (default 10 min). */
export async function storeOtpInRedis(
  redis: RedisHandle,
  otpLookup: string,
  pdfId: string,
  ttlSeconds = 600,
): Promise<void> {
  await redis.setOtp(otpLookup, pdfId, ttlSeconds);
}
