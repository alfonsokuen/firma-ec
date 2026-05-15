/**
 * inboxApi.test.ts — unit tests for the F3.5 inbox HTTP/helper layer.
 *
 * Pure logic + mocked fetch. No Svelte rendering required (we don't have
 * @testing-library/svelte in this workspace; tests focus on the
 * fetch+decrypt pipeline and the validation helpers used by Inbox.svelte
 * and DownloadResult.svelte).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Polyfill atob/btoa for the helpers used by the module.
if (typeof (globalThis as unknown as { atob?: unknown }).atob !== 'function') {
  (globalThis as unknown as { atob: (s: string) => string }).atob = (s: string) =>
    Buffer.from(s, 'base64').toString('binary');
  (globalThis as unknown as { btoa: (s: string) => string }).btoa = (s: string) =>
    Buffer.from(s, 'binary').toString('base64');
}

// Default base URL ('https://inbox.firmar.ec') is asserted directly — the
// override path through import.meta.env is exercised at runtime, not unit-tested.

const {
  verifyOtp,
  fetchMeta,
  fetchBlob,
  outboxSend,
  base64ToBytes,
  bytesToBase64,
  hexToBytes,
  isValidEcuadorPhone,
  formatSize,
  relativeTime,
  InboxApiError,
} = await import('../src/lib/inboxApi.ts');

// ─── helpers ───────────────────────────────────────────────────────────

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { ...init, headers });
}

function arrayBufResponse(
  buf: ArrayBuffer,
  headers: Record<string, string>,
  init: ResponseInit = {},
): Response {
  const h = new Headers(init.headers ?? {});
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  return new Response(buf, { ...init, headers: h });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── helpers (pure) ────────────────────────────────────────────────────

describe('helpers', () => {
  it('isValidEcuadorPhone accepts +593 mobile and rejects junk', () => {
    expect(isValidEcuadorPhone('+593984119294')).toBe(true);
    expect(isValidEcuadorPhone('+593989778888')).toBe(true);
    expect(isValidEcuadorPhone('+593212345678')).toBe(true); // landline starts with 2
    expect(isValidEcuadorPhone('  +593984119294  ')).toBe(true);
    // bad
    expect(isValidEcuadorPhone('593984119294')).toBe(false); // no plus
    expect(isValidEcuadorPhone('+59398411929')).toBe(false); // 8 digits after country
    expect(isValidEcuadorPhone('+5939841192945')).toBe(false); // 10 digits
    expect(isValidEcuadorPhone('+593184119294')).toBe(false); // starts with 1
    expect(isValidEcuadorPhone('+1234567890')).toBe(false);
    expect(isValidEcuadorPhone('')).toBe(false);
  });

  it('formatSize switches to MB above 1MB', () => {
    expect(formatSize(0)).toEqual({ value: '1', unit: 'KB' });
    expect(formatSize(1024)).toEqual({ value: '1', unit: 'KB' });
    expect(formatSize(500 * 1024)).toEqual({ value: '500', unit: 'KB' });
    const mb = formatSize(2 * 1024 * 1024);
    expect(mb.unit).toBe('MB');
    expect(mb.value).toBe('2.0');
  });

  it('relativeTime buckets by minute/hour deltas', () => {
    const now = 1_700_000_000_000;
    expect(relativeTime(new Date(now - 30_000).toISOString(), now)).toEqual({
      bucket: 'just_now',
      value: 0,
    });
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toEqual({
      bucket: 'minutes_ago',
      value: 5,
    });
    expect(relativeTime(new Date(now - 90 * 60_000).toISOString(), now)).toEqual({
      bucket: 'hours_ago',
      value: 1,
    });
  });

  it('bytesToBase64 / base64ToBytes round-trip', () => {
    const u = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
    const b64 = bytesToBase64(u);
    expect(typeof b64).toBe('string');
    const back = base64ToBytes(b64);
    expect(Array.from(back)).toEqual(Array.from(u));
  });

  it('hexToBytes parses 12-byte IV hex correctly', () => {
    const hex = '000102030405060708090a0b';
    const bytes = hexToBytes(hex);
    expect(bytes.byteLength).toBe(12);
    expect(Array.from(bytes)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(() => hexToBytes('abc')).toThrow(); // odd length
  });
});

// ─── verifyOtp ─────────────────────────────────────────────────────────

describe('verifyOtp', () => {
  it('POSTs the OTP and returns jwt+items', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        jwt: 'JWT123',
        items: [{ id: 'p1', sizeBytes: 1234, createdAt: '2026-05-09T12:00:00Z', saltB64: 'AAAA' }],
      }),
    );
    const res = await verifyOtp('123456');
    expect(res.jwt).toBe('JWT123');
    expect(res.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://inbox.firmar.ec/api/inbox/verify');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ otp: '123456' });
    // No Authorization on a public POST.
    const headers = new Headers((init?.headers as HeadersInit) ?? {});
    expect(headers.has('authorization')).toBe(false);
    expect(init?.cache).toBe('no-store');
  });

  it('throws InboxApiError on 401 bad_otp', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ code: 'bad_otp', message: 'otp not found' }, { status: 401 }),
    );
    await expect(verifyOtp('999999')).rejects.toMatchObject({
      name: 'InboxApiError',
      status: 401,
      code: 'bad_otp',
    });
  });

  it('throws InboxApiError on 429 rate_limited', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ code: 'rate_limited', message: 'slow down' }, { status: 429 }),
    );
    await expect(verifyOtp('123456')).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
    });
  });
});

// ─── fetchMeta ────────────────────────────────────────────────────────

describe('fetchMeta', () => {
  it('GETs with Bearer JWT and returns meta', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        id: 'pid',
        sizeBytes: 5000,
        saltB64: 'c2FsdA==',
        senderPhoneMasked: '+593 ** *** ****',
      }),
    );
    const meta = await fetchMeta('pid', 'JWT');
    expect(meta.saltB64).toBe('c2FsdA==');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://inbox.firmar.ec/api/inbox/pid/meta');
    expect(init?.method).toBe('GET');
    const headers = new Headers((init?.headers as HeadersInit) ?? {});
    expect(headers.get('authorization')).toBe('Bearer JWT');
    expect(init?.cache).toBe('no-store');
  });
});

// ─── fetchBlob ────────────────────────────────────────────────────────

describe('fetchBlob', () => {
  it('parses ciphertext + IV from x-iv-hex header', async () => {
    const ct = new Uint8Array([10, 20, 30, 40]);
    const ivHex = '000102030405060708090a0b'; // 12 bytes
    const buf = ct.buffer.slice(0) as ArrayBuffer;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      arrayBufResponse(buf, { 'content-type': 'application/octet-stream', 'x-iv-hex': ivHex }),
    );
    const res = await fetchBlob('pid', 'JWT');
    expect(res.iv.byteLength).toBe(12);
    expect(Array.from(res.ciphertext)).toEqual([10, 20, 30, 40]);
  });

  it('rejects when x-iv-hex header missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      arrayBufResponse(new ArrayBuffer(4), { 'content-type': 'application/octet-stream' }),
    );
    await expect(fetchBlob('pid', 'JWT')).rejects.toMatchObject({ code: 'missing_iv' });
  });

  it('rejects when iv is wrong length', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      arrayBufResponse(new ArrayBuffer(4), {
        'content-type': 'application/octet-stream',
        'x-iv-hex': '00aa', // 2 bytes — invalid
      }),
    );
    await expect(fetchBlob('pid', 'JWT')).rejects.toMatchObject({ code: 'bad_iv' });
  });
});

// ─── outboxSend ───────────────────────────────────────────────────────

describe('outboxSend', () => {
  it('posts payload with Bearer auth and returns evolutionMessageId', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ ok: true, evolutionMessageId: 'evo-1' }));
    const out = await outboxSend(
      { id: 'pid', signedPdfB64: 'AAAA', target: { kind: 'original' } },
      'JWT',
    );
    expect(out.evolutionMessageId).toBe('evo-1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://inbox.firmar.ec/api/outbox/send');
    expect(init?.method).toBe('POST');
    const headers = new Headers((init?.headers as HeadersInit) ?? {});
    expect(headers.get('authorization')).toBe('Bearer JWT');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      id: 'pid',
      signedPdfB64: 'AAAA',
      target: { kind: 'original' },
    });
  });

  it('forwards the validated phone target verbatim', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ ok: true, evolutionMessageId: 'evo-2' }));
    await outboxSend(
      { id: 'pid', signedPdfB64: 'AAAA', target: { kind: 'phone', phone: '+593984119294' } },
      'JWT',
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.target).toEqual({ kind: 'phone', phone: '+593984119294' });
  });

  it('maps 422 invalid_phone into InboxApiError code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ code: 'invalid_phone', message: 'phone must be +593 E.164' }, { status: 422 }),
    );
    const promise = outboxSend(
      { id: 'pid', signedPdfB64: 'AAAA', target: { kind: 'phone', phone: 'bad' } },
      'JWT',
    );
    await expect(promise).rejects.toBeInstanceOf(InboxApiError);
    await expect(promise).rejects.toMatchObject({ status: 422, code: 'invalid_phone' });
  });
});
