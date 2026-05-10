import { describe, it, expect } from 'vitest';
import { hashPhone, maskPhone, normalizePhoneEC } from '../src/lib/phone-hash.js';
import { InboxError } from '../src/lib/errors.js';

const SECRET = 'deploy-secret-fixture';

describe('normalizePhoneEC', () => {
  it('accepts +593 E.164', () => {
    expect(normalizePhoneEC('+593989778888')).toBe('+593989778888');
  });
  it('strips WhatsApp JID', () => {
    expect(normalizePhoneEC('593989778888@s.whatsapp.net')).toBe('+593989778888');
  });
  it('promotes raw 593...', () => {
    expect(normalizePhoneEC('593989778888')).toBe('+593989778888');
  });
  it('promotes 0XXXXXXXXX national', () => {
    expect(normalizePhoneEC('0989778888')).toBe('+593989778888');
  });
  it('rejects non-EC phone', () => {
    expect(() => normalizePhoneEC('+12025551212')).toThrow(InboxError);
  });
  it('rejects bogus input', () => {
    expect(() => normalizePhoneEC('abc')).toThrow(InboxError);
  });
});

describe('hashPhone', () => {
  it('is deterministic given same secret + phone', () => {
    expect(hashPhone('+593989778888', SECRET)).toBe(hashPhone('+593989778888', SECRET));
  });
  it('differs for different secrets', () => {
    expect(hashPhone('+593989778888', 'a')).not.toBe(hashPhone('+593989778888', 'b'));
  });
  it('normalizes JID before hashing', () => {
    expect(hashPhone('593989778888@s.whatsapp.net', SECRET)).toBe(
      hashPhone('+593989778888', SECRET),
    );
  });
});

describe('maskPhone', () => {
  it('shows only last 4 digits', () => {
    expect(maskPhone('+593989778888')).toBe('+593 ** *** 8888');
  });
});
