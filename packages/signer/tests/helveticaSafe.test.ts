/**
 * Regresión: el medidor y el codificador de la estampa lanzaban con un
 * carácter fuera de WinAnsi (`WinAnsi cannot encode`), y esa excepción sin
 * código llegaba al usuario como «No se pudo firmar · code: unknown». El caso
 * real (2026-09-06): la Ñ del apellido leída como `Ã` + U+0091 desde un
 * TeletexString con UTF-8 dentro. Además el codificador usaba el byte bajo del
 * code point, con lo que `’` (U+2019) salía como 0x19 y `€` como 0xAC.
 */
import { describe, expect, it } from 'vitest';
import { helveticaSafe, toWinAnsiHex, truncateToWidth, widthOfText } from '../src/textFit.js';
import { measureHelvetica, splitCNIntoLines } from '../src/visibleSig.js';

const CONTROL_0X91 = String.fromCharCode(0x91);
const MOJIBAKE_CN = `JIMMY LEANDRO MEJIA SIMBAÃ${CONTROL_0X91}A`;

describe('helveticaSafe', () => {
  it('deja intacto lo que WinAnsi sí tiene (Ñ, tildes, ü, elipsis, comillas tipográficas)', () => {
    const text = 'MUÑOZ PEÑA JOSÉ ü … ’ € ª';
    expect(helveticaSafe(text)).toBe(text);
  });

  it('sustituye el carácter de control del mojibake en vez de lanzar', () => {
    expect(() => helveticaSafe(MOJIBAKE_CN)).not.toThrow();
    expect(helveticaSafe(MOJIBAKE_CN)).toBe('JIMMY LEANDRO MEJIA SIMBAÃ?A');
  });

  it('un carácter con diacrítico fuera de WinAnsi cae a su base; sin base, a ?', () => {
    expect(helveticaSafe('Čapek')).toBe('Capek');
    expect(helveticaSafe('Łukasz')).toBe('?ukasz');
    expect(helveticaSafe('日本')).toBe('??');
  });
});

describe('toWinAnsiHex', () => {
  it('usa la tabla WinAnsi real, no el byte bajo del code point', () => {
    expect(toWinAnsiHex('…')).toBe('85');
    expect(toWinAnsiHex('’')).toBe('92');
    expect(toWinAnsiHex('€')).toBe('80');
    expect(toWinAnsiHex('Ñ')).toBe('d1');
    expect(toWinAnsiHex('A')).toBe('41');
  });

  it('nunca lanza: el control del mojibake sale como ?', () => {
    expect(toWinAnsiHex(`A${CONTROL_0X91}`)).toBe('413f');
  });
});

describe('medir y repartir con un nombre que WinAnsi no puede escribir', () => {
  it('widthOfText y measureHelvetica devuelven un número finito', () => {
    expect(Number.isFinite(widthOfText(MOJIBAKE_CN, 8))).toBe(true);
    expect(Number.isFinite(measureHelvetica(MOJIBAKE_CN, 8))).toBe(true);
  });

  it('splitCNIntoLines y truncateToWidth no lanzan y conservan el nombre', () => {
    const [line1, line2] = splitCNIntoLines(MOJIBAKE_CN, 8, 100, 162);
    expect(`${line1} ${line2 ?? ''}`.trim()).toBe(MOJIBAKE_CN);
    expect(truncateToWidth(MOJIBAKE_CN, 8, 40)).toMatch(/…$/);
  });
});
