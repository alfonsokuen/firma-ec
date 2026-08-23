/**
 * lote-verify.ts — INDEPENDENT verification for the batch-signing E2E.
 *
 * "Independent" is the point: `@firma-ec/signer` builds its CMS with pkijs
 * and its PDF objects with pdf-lib. Nothing here reuses that code path:
 *
 *   - Cryptographic validity  → node-forge is used ONLY as an ASN.1 *parser*
 *     (to locate the signed attributes, the certificate and the signature
 *     value inside the CMS); the actual RSA verification and the SHA-256 of
 *     the covered bytes run on Node's built-in `node:crypto`. A bug in the
 *     signer's pkijs assembly cannot "verify itself" here.
 *   - ByteRange coverage      → parsed straight off the PDF bytes with no
 *     PDF library at all.
 *   - Seal placement          → Mozilla's pdf.js (`pdfjs-dist`, already a PWA
 *     dependency) reads the widget annotation and maps it to VIEWPORT
 *     coordinates — i.e. the page *as a viewer displays it*, with `/Rotate`
 *     and `/CropBox` applied. That is the user-facing truth the placement
 *     criteria are stated in.
 *
 * Runs in Node (inside the Playwright spec), never in the browser.
 */

import { createHash, createVerify } from 'node:crypto';
import forge from 'node-forge';

// ---------- Cryptographic verification (CMS / PAdES B-B detached) ----------

/** OID for the CMS `message-digest` signed attribute (RFC 5652 §11.2). */
const OID_MESSAGE_DIGEST_ATTR = '1.2.840.113549.1.9.4';

export interface PadesVerifyReport {
  /** `/ByteRange` starts at 0, ends at EOF, and the only gap is `/Contents`. */
  byteRangeCoversDocument: boolean;
  /** `message-digest` signed attribute == SHA-256 of the covered bytes. */
  digestMatches: boolean;
  /** RSA signature over the signed attributes verifies with the embedded cert. */
  signatureValid: boolean;
  /** Subject CN of the certificate that verified the signature (diagnostic). */
  signerCN?: string;
  /**
   * Hex serial number of the certificate that verified the signature. Lets
   * the spec assert "every output of the batch was signed by the SAME
   * certificate" without depending on the CN alone (a real CA can issue two
   * certs with an identical subject CN).
   */
  signerSerialHex?: string;
  /** Human-readable reason for the first failed check (diagnostic). */
  failure?: string;
}

/**
 * Verify the LAST (and in this E2E, only) PAdES signature of `pdf` without
 * touching `@firma-ec/signer` / `@firma-ec/verifier`. Never throws for an
 * invalid document — invalidity is the *result*, reported per check.
 */
/**
 * Locate the final `/ByteRange` (the one whose ranges close at EOF). Exported
 * so the spec's negative controls can tamper INSIDE the signature's hex gap
 * (`[len1, start2)`) instead of guessing at offsets.
 */
export function findFinalByteRange(
  pdf: Uint8Array,
): [start: number, len1: number, start2: number, len2: number] | null {
  const latin1 = Buffer.from(pdf).toString('latin1');
  const brRegex = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  let byteRange: [number, number, number, number] | null = null;
  for (const m of latin1.matchAll(brRegex)) {
    const parts = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
    if (parts[2] + parts[3] === pdf.length) byteRange = parts;
  }
  return byteRange;
}

export function verifyPadesIndependently(pdf: Uint8Array): PadesVerifyReport {
  const buf = Buffer.from(pdf);
  const latin1 = buf.toString('latin1');

  const byteRange = findFinalByteRange(pdf);
  if (!byteRange) {
    return invalid('no /ByteRange closing at EOF found');
  }
  const [start, len1, start2, len2] = byteRange;

  // 2. Coverage: [0, len1) ∪ [start2, EOF), gap = the /Contents hex string.
  const gap = latin1.slice(len1, start2);
  const byteRangeCoversDocument =
    start === 0 &&
    start2 + len2 === buf.length &&
    start2 > len1 &&
    /^<[0-9a-fA-F]*>$/.test(gap.trim());
  if (!byteRangeCoversDocument) {
    return { ...invalid('/ByteRange does not cover the document'), byteRangeCoversDocument };
  }

  const covered = Buffer.concat([buf.subarray(start, len1), buf.subarray(start2, start2 + len2)]);

  // 3. Extract the DER CMS from the hex /Contents (right-padded with zeros to
  //    the reserved placeholder size — trim to the real DER length).
  const hex = gap.trim().slice(1, -1);
  const padded = Buffer.from(hex, 'hex');
  const der = padded.subarray(0, derTotalLength(padded));

  // 4. Parse with forge (parser only) and pull out the pieces to verify.
  let attrsDer: Buffer;
  let signature: Buffer;
  let certs: forge.pki.Certificate[];
  let messageDigestAttr: Buffer | null;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(der.toString('latin1')));
    const p7 = forge.pkcs7.messageFromAsn1(asn1) as forge.pkcs7.PkcsSignedData & {
      rawCapture: { authenticatedAttributes: forge.asn1.Asn1[]; signature: string };
    };
    const attrs = p7.rawCapture.authenticatedAttributes;
    if (!attrs || attrs.length === 0) return invalid('CMS has no signed attributes');
    // Signed attributes are DER-encoded as EXPLICIT SET OF for the signature
    // input (RFC 5652 §5.4) even though they appear [0] IMPLICIT on the wire.
    const attrSet = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrs);
    attrsDer = Buffer.from(forge.asn1.toDer(attrSet).getBytes(), 'latin1');
    signature = Buffer.from(p7.rawCapture.signature, 'latin1');
    certs = p7.certificates;
    messageDigestAttr = extractMessageDigest(attrs);
  } catch (e) {
    return invalid(`CMS parse failed: ${(e as Error).message}`);
  }
  if (!messageDigestAttr) return invalid('CMS has no message-digest signed attribute');
  if (!certs || certs.length === 0) return invalid('CMS embeds no certificate');

  // 5. message-digest == SHA-256(covered bytes) — computed with node:crypto.
  const actualDigest = createHash('sha256').update(covered).digest();
  const digestMatches = actualDigest.equals(messageDigestAttr);

  // 6. RSA verification of the signed attributes with node:crypto. The signer
  //    cert is whichever embedded cert verifies (our fixtures embed one).
  let signatureValid = false;
  let signerCN: string | undefined;
  let signerSerialHex: string | undefined;
  for (const cert of certs) {
    try {
      const pubPem = forge.pki.publicKeyToPem(cert.publicKey as forge.pki.rsa.PublicKey);
      const ok = createVerify('RSA-SHA256').update(attrsDer).verify(pubPem, signature);
      if (ok) {
        signatureValid = true;
        signerCN = cert.subject.getField('CN')?.value as string | undefined;
        signerSerialHex = cert.serialNumber;
        break;
      }
    } catch {
      // A non-RSA cert in the bag is not an error — just not the signer.
    }
  }

  return {
    byteRangeCoversDocument,
    digestMatches,
    signatureValid,
    ...(signerCN !== undefined ? { signerCN } : {}),
    ...(signerSerialHex !== undefined ? { signerSerialHex } : {}),
    ...(digestMatches && signatureValid
      ? {}
      : { failure: !digestMatches ? 'message-digest mismatch' : 'signature does not verify' }),
  };
}

function invalid(reason: string): PadesVerifyReport {
  return {
    byteRangeCoversDocument: false,
    digestMatches: false,
    signatureValid: false,
    failure: reason,
  };
}

/** Total encoded length (header + content) of the first DER value in `b`. */
function derTotalLength(b: Buffer): number {
  if (b.length < 2) return b.length;
  const lenByte = b[1]!;
  if (lenByte < 0x80) return 2 + lenByte;
  const numLenBytes = lenByte & 0x7f;
  let contentLen = 0;
  for (let i = 0; i < numLenBytes; i++) contentLen = contentLen * 256 + b[2 + i]!;
  return 2 + numLenBytes + contentLen;
}

/** Pull the `message-digest` OCTET STRING out of the signed attributes. */
function extractMessageDigest(attrs: forge.asn1.Asn1[]): Buffer | null {
  for (const attr of attrs) {
    const children = attr.value as forge.asn1.Asn1[];
    if (!Array.isArray(children) || children.length < 2) continue;
    const oid = forge.asn1.derToOid(forge.util.createBuffer(children[0]!.value as string));
    if (oid !== OID_MESSAGE_DIGEST_ATTR) continue;
    const set = children[1]!.value as forge.asn1.Asn1[];
    if (!Array.isArray(set) || set.length === 0) continue;
    return Buffer.from(set[0]!.value as string, 'latin1');
  }
  return null;
}

// ---------- Seal placement, as displayed (pdf.js) ----------

/** A widget rect in VIEWPORT coordinates (origin top-left, y grows down). */
export interface DisplayedSealRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface DisplayedPlacement {
  /** Displayed page size (CropBox ∩ MediaBox with /Rotate applied). */
  viewportWidth: number;
  viewportHeight: number;
  /** Every signature-widget rect on page 1, in viewport coordinates. */
  seals: DisplayedSealRect[];
}

/**
 * Read the signature widget(s) of page 1 and express them in the coordinate
 * system of the DISPLAYED page, using pdf.js — the same engine the PWA's own
 * preview uses, but crucially not the engine that placed or drew the seal.
 */
export async function readDisplayedSealPlacement(pdf: Uint8Array): Promise<DisplayedPlacement> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    // pdf.js transfers the buffer — hand it a private copy.
    data: pdf.slice(),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const annotations = (await page.getAnnotations()) as Array<{
      subtype?: string;
      fieldType?: string;
      rect?: number[];
    }>;
    const seals: DisplayedSealRect[] = [];
    for (const a of annotations) {
      if (a.subtype !== 'Widget' || a.fieldType !== 'Sig' || !a.rect) continue;
      const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle(
        a.rect as [number, number, number, number],
      );
      seals.push({
        x0: Math.min(vx1, vx2),
        y0: Math.min(vy1, vy2),
        x1: Math.max(vx1, vx2),
        y1: Math.max(vy1, vy2),
      });
    }
    return { viewportWidth: viewport.width, viewportHeight: viewport.height, seals };
  } finally {
    await doc.destroy();
  }
}
