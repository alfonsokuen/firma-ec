import {
  sha256 as nobleSha256,
  sha384 as nobleSha384,
  sha512 as nobleSha512,
} from '@noble/hashes/sha2';

export type HashAlgo = 'SHA-256' | 'SHA-384' | 'SHA-512';

export async function digest(algo: HashAlgo, data: Uint8Array): Promise<Uint8Array> {
  // Prefer Web Crypto: it's hardware-accelerated and audited natively by the browser.
  try {
    // Cast to ArrayBuffer to satisfy strict SubtleCrypto overload (SharedArrayBuffer excluded)
    const ab = await crypto.subtle.digest(algo, data.buffer as ArrayBuffer);
    return new Uint8Array(ab);
  } catch (_e) {
    // Fallback (e.g., insecure context or older runtime)
    switch (algo) {
      case 'SHA-256':
        return nobleSha256(data);
      case 'SHA-384':
        return nobleSha384(data);
      case 'SHA-512':
        return nobleSha512(data);
    }
  }
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  if (clean.length % 2) throw new Error('Invalid hex string length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = Number.parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  return out;
}
