/**
 * Regresión: una CA emitió el CN como TeletexString con UTF-8 dentro. asn1js
 * decodifica ese tipo byte a byte (Latin-1), así que «SIMBAÑA» llegaba como
 * `SIMBAÃ` + U+0091 + `A`: mojibake en pantalla y, peor, un carácter de
 * control que el codificador WinAnsi de la estampa no acepta — la firma caía
 * con «code: unknown» (2026-09-06, certificado real de un usuario).
 */
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { describe, expect, it } from 'vitest';
import { decodeAsn1DirectoryString, repairUtf8DecodedAsLatin1, subjectInfo } from '../src/x509';

const OID_CN = '2.5.4.3';
const N_TILDE = 'Ñ';
/** Los dos bytes UTF-8 de la Ñ leídos como dos caracteres Latin-1. */
const N_TILDE_AS_LATIN1_PAIR = String.fromCharCode(0xc3, 0x91);

function certWithCN(value: asn1js.BaseBlock): pkijs.Certificate {
  const cert = new pkijs.Certificate();
  cert.subject.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: OID_CN, value }));
  return cert;
}

describe('repairUtf8DecodedAsLatin1', () => {
  it('repara UTF-8 leído como Latin-1', () => {
    expect(repairUtf8DecodedAsLatin1(`SIMBA${N_TILDE_AS_LATIN1_PAIR}A`)).toBe(`SIMBA${N_TILDE}A`);
    expect(repairUtf8DecodedAsLatin1(String.fromCharCode(0xc3, 0xa9))).toBe('é');
  });

  it('deja intacto el Latin-1 auténtico y el ASCII', () => {
    expect(repairUtf8DecodedAsLatin1(`SIMBA${N_TILDE}A`)).toBe(`SIMBA${N_TILDE}A`);
    expect(repairUtf8DecodedAsLatin1('ALFONSO KUEN')).toBe('ALFONSO KUEN');
    expect(repairUtf8DecodedAsLatin1('')).toBe('');
  });

  it('no toca cadenas con caracteres fuera de un byte (ya bien decodificadas)', () => {
    expect(repairUtf8DecodedAsLatin1('Ã‘')).toBe('Ã‘');
    expect(repairUtf8DecodedAsLatin1('Łukasz')).toBe('Łukasz');
  });
});

describe('decodeAsn1DirectoryString', () => {
  it('TeletexString con UTF-8 dentro → texto correcto', () => {
    const block = new asn1js.TeletexString({ value: `SIMBA${N_TILDE_AS_LATIN1_PAIR}A` });
    expect(decodeAsn1DirectoryString(block)).toBe(`SIMBA${N_TILDE}A`);
  });

  it('PrintableString con UTF-8 dentro → texto correcto', () => {
    const block = new asn1js.PrintableString({ value: `MU${String.fromCharCode(0xc3, 0xb1)}OZ` });
    expect(decodeAsn1DirectoryString(block)).toBe('MUñOZ');
  });

  it('UTF8String correcto se devuelve tal cual', () => {
    const block = new asn1js.Utf8String({ value: `SIMBA${N_TILDE}A` });
    expect(decodeAsn1DirectoryString(block)).toBe(`SIMBA${N_TILDE}A`);
  });

  it('BMPString no pasa por la reparación', () => {
    const block = new asn1js.BmpString({ value: `SIMBA${N_TILDE}A` });
    expect(decodeAsn1DirectoryString(block)).toBe(`SIMBA${N_TILDE}A`);
  });

  it('sobrevive a un DER real: TeletexString serializada y vuelta a leer', () => {
    const der = new asn1js.TeletexString({ value: `SIMBA${N_TILDE_AS_LATIN1_PAIR}A` }).toBER(false);
    const parsed = asn1js.fromBER(der);
    expect(parsed.offset).not.toBe(-1);
    expect(decodeAsn1DirectoryString(parsed.result)).toBe(`SIMBA${N_TILDE}A`);
  });
});

describe('subjectInfo', () => {
  it('el CN de un certificado con TeletexString UTF-8 sale con la Ñ', () => {
    const cert = certWithCN(
      new asn1js.TeletexString({ value: `JIMMY LEANDRO MEJIA SIMBA${N_TILDE_AS_LATIN1_PAIR}A` }),
    );
    expect(subjectInfo(cert).cn).toBe(`JIMMY LEANDRO MEJIA SIMBA${N_TILDE}A`);
  });

  it('el CN UTF8String de siempre no cambia', () => {
    const cert = certWithCN(new asn1js.Utf8String({ value: 'BEATRIZ DE LOURDES VALENCIA CACERES' }));
    expect(subjectInfo(cert).cn).toBe('BEATRIZ DE LOURDES VALENCIA CACERES');
  });
});
