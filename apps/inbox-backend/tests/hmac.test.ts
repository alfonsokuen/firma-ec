import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hmacHex, verifyEvolutionSignature } from '../src/lib/hmac.js';

const SECRET = 'test-secret';

describe('verifyEvolutionSignature', () => {
  function sign(body: Buffer, secret = SECRET): string {
    return createHmac('sha256', secret).update(body).digest('hex');
  }

  it('returns true for matching hex signature', () => {
    const body = Buffer.from('{"hello":"world"}');
    expect(verifyEvolutionSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('tolerates `sha256=` prefix', () => {
    const body = Buffer.from('payload');
    expect(verifyEvolutionSignature(body, `sha256=${sign(body)}`, SECRET)).toBe(true);
  });

  it('returns false for tampered body', () => {
    const body = Buffer.from('original');
    const sig = sign(body);
    expect(verifyEvolutionSignature(Buffer.from('tampered'), sig, SECRET)).toBe(false);
  });

  it('returns false for wrong secret', () => {
    const body = Buffer.from('x');
    expect(verifyEvolutionSignature(body, sign(body, 'other'), SECRET)).toBe(false);
  });

  it('returns false for empty/missing header', () => {
    expect(verifyEvolutionSignature(Buffer.from('x'), undefined, SECRET)).toBe(false);
    expect(verifyEvolutionSignature(Buffer.from('x'), '', SECRET)).toBe(false);
    expect(verifyEvolutionSignature(Buffer.from('x'), null, SECRET)).toBe(false);
  });

  it('returns false for non-hex header', () => {
    expect(verifyEvolutionSignature(Buffer.from('x'), 'not-hex!!', SECRET)).toBe(false);
  });
});

describe('hmacHex', () => {
  it('produces stable hex output', () => {
    expect(hmacHex('k', 'data')).toBe(hmacHex('k', 'data'));
    expect(hmacHex('k', 'data')).not.toBe(hmacHex('k', 'data2'));
  });
});
