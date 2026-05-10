import { createHmac } from 'node:crypto';
import { InboxError } from './errors.js';

const E164_EC = /^\+593[2-9]\d{8}$/;

/**
 * Validate and normalize an Ecuadorean E.164 phone number.
 * Accepts WhatsApp `<digits>@s.whatsapp.net` JIDs and `+593...` formats.
 */
export function normalizePhoneEC(input: string): string {
  let s = (input ?? '').trim();
  // Strip WhatsApp JID suffix.
  const at = s.indexOf('@');
  if (at >= 0) s = s.slice(0, at);
  // Allow `593...` (no +) by prefixing.
  if (/^593\d{9}$/.test(s)) s = `+${s}`;
  // Allow national `0XXXXXXXXX` → +593XXXXXXXXX.
  if (/^0\d{9}$/.test(s)) s = `+593${s.slice(1)}`;
  if (!E164_EC.test(s)) {
    throw new InboxError('invalid_phone', `not a valid E.164 EC phone: ${s}`);
  }
  return s;
}

/**
 * Server-side stable hash for phone numbers. Uses the deploy secret as the
 * HMAC key; same number → same hash on this deployment, but unrecoverable
 * without the secret (privacy).
 */
export function hashPhone(e164: string, deploySecret: string): string {
  const normalized = normalizePhoneEC(e164);
  return createHmac('sha256', deploySecret).update(normalized).digest('hex');
}

/**
 * Mask a phone number for human-facing display. Keeps last 4 digits.
 *   +593989778888 → "+593 ** *** 8888"
 */
export function maskPhone(e164: string): string {
  const normalized = normalizePhoneEC(e164);
  const last4 = normalized.slice(-4);
  return `+593 ** *** ${last4}`;
}
