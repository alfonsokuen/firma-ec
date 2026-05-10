import { describe, it, expect } from 'vitest';
import { issueJwt, verifyJwt } from '../src/lib/jwt.js';

const SECRET = 'jwt-secret-with-enough-entropy-xyz';

describe('jwt', () => {
  it('round-trips otpHash', async () => {
    const token = await issueJwt('hash-abc', SECRET);
    const payload = await verifyJwt(token, SECRET);
    expect(payload.otpHash).toBe('hash-abc');
  });

  it('rejects wrong secret', async () => {
    const token = await issueJwt('h', SECRET);
    await expect(verifyJwt(token, 'wrong-secret-xxxxxxxxxxxxxxxxxx')).rejects.toThrow();
  });

  it('rejects expired token', async () => {
    const token = await issueJwt('h', SECRET, -1);
    await expect(verifyJwt(token, SECRET)).rejects.toThrow();
  });

  it('rejects malformed token', async () => {
    await expect(verifyJwt('not.a.jwt', SECRET)).rejects.toThrow();
  });
});
