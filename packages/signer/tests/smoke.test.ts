import { describe, expect, it } from 'vitest';
import { SignerError, signPdf } from '../src/index.js';
import type { SignOptions } from '../src/index.js';

describe('@firma-ec/signer smoke', () => {
  it('exports signPdf as a function', () => {
    expect(typeof signPdf).toBe('function');
  });

  it('exports SignerError class', () => {
    const err = new SignerError('unknown', 'test');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('unknown');
    expect(err.name).toBe('SignerError');
  });

  it('signPdf placeholder throws SignerError(unknown) — pending F3 Task 4+', async () => {
    const opts: SignOptions = {
      pdf: new Uint8Array(0),
      pfx: new Uint8Array(0),
      pin: '',
      visibleSig: { pageIndex: 0, x: 0, y: 0, w: 1, h: 1, size: 'standard' },
    };
    await expect(signPdf(opts)).rejects.toBeInstanceOf(SignerError);
    await expect(signPdf(opts)).rejects.toMatchObject({ code: 'unknown' });
  });
});
