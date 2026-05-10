import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify an HMAC-SHA256 signature for an Evolution webhook body.
 * Header value is hex-encoded (no `sha256=` prefix; tolerate it if present).
 */
export function verifyEvolutionSignature(
  rawBody: Buffer,
  header: string | undefined | null,
  secret: string,
): boolean {
  if (header === undefined || header === null || header === '') return false;
  const cleaned = header.startsWith('sha256=') ? header.slice(7) : header;
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) return false;
  let provided: Buffer;
  try {
    provided = Buffer.from(cleaned, 'hex');
  } catch {
    return false;
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/** Hex-encode an HMAC-SHA256 of `data` with `secret`. */
export function hmacHex(secret: string, data: string | Buffer): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}
