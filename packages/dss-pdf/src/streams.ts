/**
 * PDF stream object builder for DSS items (DER cert / OCSP / CRL bytes).
 *
 * ISO 32000-1 §7.3.8: stream objects are serialized as
 *   <objNum> <gen> obj
 *   << /Length N >>
 *   stream
 *   <bytes>
 *   endstream
 *   endobj
 *
 * Per spec §4.2: DSS streams ship **uncompressed** (no /Filter /FlateDecode).
 * Adobe Reader writes them this way and ETSI doesn't mandate compression — the
 * verifier path is simpler if we don't have to FlateDecode every time.
 *
 * Browser-compatible. No node:* imports.
 */

/**
 * Serialize a single indirect stream object whose body is `der`.
 *
 * @param objNum  Object number to assign.
 * @param genNum  Generation number (typically 0 for new objects).
 * @param der     Raw DER bytes (cert, OCSP response, CRL).
 * @returns       UTF-8 bytes of the full `<n> <g> obj ... endobj\n` sequence.
 */
export function serializeStreamObject(objNum: number, genNum: number, der: Uint8Array): Uint8Array {
  if (objNum < 1 || !Number.isInteger(objNum)) {
    throw new Error(`streams: invalid objNum ${objNum}`);
  }
  if (genNum < 0 || !Number.isInteger(genNum)) {
    throw new Error(`streams: invalid genNum ${genNum}`);
  }
  if (!(der instanceof Uint8Array)) {
    throw new Error('streams: der must be Uint8Array');
  }
  const header = `${objNum} ${genNum} obj\n` + `<< /Length ${der.length} >>\n` + `stream\n`;
  const trailer = `\nendstream\nendobj\n`;
  const enc = new TextEncoder();
  const headerBytes = enc.encode(header);
  const trailerBytes = enc.encode(trailer);
  const out = new Uint8Array(headerBytes.length + der.length + trailerBytes.length);
  out.set(headerBytes, 0);
  out.set(der, headerBytes.length);
  out.set(trailerBytes, headerBytes.length + der.length);
  return out;
}

/**
 * Serialize an array of DER blobs as contiguous indirect stream objects.
 * Object numbers are assigned starting at `startObjNum`.
 *
 * @returns
 *   - `bytes`: concatenated bytes ready to splice into the incremental tail.
 *   - `offsets`: per-object absolute offsets relative to `baseOffset`.
 *     `offsets[i]` is the byte offset of the start of `<n> 0 obj\n...` for the
 *     i-th DER blob.
 *   - `objNums`: object numbers assigned (startObjNum..startObjNum+ders.length-1).
 *
 * `baseOffset` is the absolute file offset where the first byte of `bytes` will
 * land in the final output PDF — used so callers can write the xref table
 * without recomputing.
 */
export function serializeStreams(
  ders: Uint8Array[],
  startObjNum: number,
  baseOffset: number,
): { bytes: Uint8Array; offsets: number[]; objNums: number[] } {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  const objNums: number[] = [];
  let cursor = baseOffset;
  for (let i = 0; i < ders.length; i++) {
    const objNum = startObjNum + i;
    const serialized = serializeStreamObject(objNum, 0, ders[i]!);
    offsets.push(cursor);
    objNums.push(objNum);
    parts.push(serialized);
    cursor += serialized.length;
  }
  // Concatenate.
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return { bytes: out, offsets, objNums };
}
