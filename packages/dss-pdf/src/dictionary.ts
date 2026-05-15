/**
 * DSS dictionary builder (ISO 32000-2 §12.8.4 + ETSI EN 319 142-1 §5.4).
 *
 * Produces the serialized text of `<dssObjNum> 0 obj << /Type /DSS ... >> endobj`
 * given index references into the global Cert/OCSP/CRL stream arrays.
 *
 * Structure (per spec §2.2):
 *   << /Type /DSS
 *      /Certs [<ref1> <ref2> ...]
 *      /OCSPs [<ref> ...]
 *      /CRLs  [<ref> ...]
 *      /VRI << /<HEXSIGHASH> << /Cert [...] /OCSP [...] /CRL [...] /TS <ref> >> >>
 *   >>
 *
 * Browser-compatible. No node:* imports.
 */

import type { VriEntry } from './index';

/**
 * Build an indirect-reference array fragment: `[1 0 R 2 0 R ...]`.
 */
function refArray(objNums: number[]): string {
  if (objNums.length === 0) return '[]';
  return '[' + objNums.map((n) => `${n} 0 R`).join(' ') + ']';
}

export interface DssDictRefs {
  /** Object numbers of the cert streams in /Certs (global array). */
  certObjNums: number[];
  /** Object numbers of the OCSP streams in /OCSPs (global array). */
  ocspObjNums: number[];
  /** Object numbers of the CRL streams in /CRLs (global array). */
  crlObjNums: number[];
  /**
   * VRI map keyed by uppercase hex SHA-1 of the signature /Contents bytes.
   * Each entry's indices reference positions in the corresponding global array
   * (0-based). Resolved here to object-number refs.
   */
  vri: Record<string, VriEntry>;
}

/**
 * Serialize the DSS dictionary as a single indirect object.
 *
 * @param dssObjNum  Object number to assign to the DSS dict.
 * @param refs       Refs into the global /Certs, /OCSPs, /CRLs arrays.
 * @returns          UTF-8 bytes of `<n> 0 obj << /Type /DSS ... >> endobj\n`.
 */
export function serializeDssDict(dssObjNum: number, refs: DssDictRefs): Uint8Array {
  if (dssObjNum < 1 || !Number.isInteger(dssObjNum)) {
    throw new Error(`dictionary: invalid dssObjNum ${dssObjNum}`);
  }

  // Resolve each VRI entry's indices to the actual object numbers in the
  // global arrays.
  const vriEntries: string[] = [];
  for (const [hexHash, entry] of Object.entries(refs.vri)) {
    const certRefs = entry.certIndices
      .map((i) => refs.certObjNums[i])
      .filter((n): n is number => typeof n === 'number');
    const ocspRefs = entry.ocspIndices
      .map((i) => refs.ocspObjNums[i])
      .filter((n): n is number => typeof n === 'number');
    const crlRefs = entry.crlIndices
      .map((i) => refs.crlObjNums[i])
      .filter((n): n is number => typeof n === 'number');
    const tsRef =
      typeof entry.timestampTokenIndex === 'number'
        ? refs.ocspObjNums[entry.timestampTokenIndex]
        : undefined;

    let body =
      `/Cert ${refArray(certRefs)} ` + `/OCSP ${refArray(ocspRefs)} ` + `/CRL ${refArray(crlRefs)}`;
    if (typeof tsRef === 'number') {
      body += ` /TS ${tsRef} 0 R`;
    }
    // PDF name token rules: must start with /. Spec mandates uppercase hex SHA-1.
    vriEntries.push(`/${hexHash} << ${body} >>`);
  }

  const vriFragment = vriEntries.length > 0 ? `/VRI << ${vriEntries.join(' ')} >>` : '';

  const body =
    `<< /Type /DSS ` +
    `/Certs ${refArray(refs.certObjNums)} ` +
    `/OCSPs ${refArray(refs.ocspObjNums)} ` +
    `/CRLs ${refArray(refs.crlObjNums)}` +
    (vriFragment.length > 0 ? ` ${vriFragment}` : '') +
    ` >>`;

  const text = `${dssObjNum} 0 obj\n${body}\nendobj\n`;
  return new TextEncoder().encode(text);
}
