/**
 * Nombres de entrada del ZIP: saneado y colisiones.
 *
 * Dos modos de fallo concretos que este archivo cubre:
 *   - Una colisión hace que el segundo documento PISE al primero: el usuario
 *     firma 12 archivos, extrae 9 y no hay ningún error a la vista.
 *   - Un nombre hostil (`..\\`, `CON.pdf`, `a:b`) rompe la extracción en
 *     Windows, o peor, escribe fuera del directorio de destino.
 */

import { describe, expect, it } from 'vitest';
import { BatchZipWriter, stripControlChars, zipEntryNameFor } from './batchZip';

describe('saneado de nombres', () => {
  it('conserva el nombre y añade el sufijo antes de la extensión', () => {
    expect(zipEntryNameFor('contrato.pdf')).toBe('contrato-firmado.pdf');
    expect(zipEntryNameFor('Contrato Final V2.PDF')).toBe('Contrato Final V2-firmado.pdf');
    expect(zipEntryNameFor('sin-extension')).toBe('sin-extension-firmado.pdf');
  });

  it('conserva acentos y ñ (UTF-8 declarado en la cabecera)', () => {
    expect(zipEntryNameFor('Año fiscal — señalización.pdf')).toBe(
      'Año fiscal — señalización-firmado.pdf',
    );
  });

  it('sustituye los caracteres que Windows no admite', () => {
    expect(zipEntryNameFor('a<b>c:d"e|f?g*h.pdf')).toBe('a_b_c_d_e_f_g_h-firmado.pdf');
  });

  it('descarta cualquier componente de ruta (nada escribe fuera del destino)', () => {
    expect(zipEntryNameFor('..\\..\\Windows\\System32\\evil.pdf')).toBe('evil-firmado.pdf');
    expect(zipEntryNameFor('/etc/passwd.pdf')).toBe('passwd-firmado.pdf');
    expect(zipEntryNameFor('../../..')).toBe('documento-firmado.pdf');
  });

  it('neutraliza los nombres de dispositivo reservados de Windows', () => {
    expect(zipEntryNameFor('CON.pdf')).toBe('_CON-firmado.pdf');
    expect(zipEntryNameFor('nul.pdf')).toBe('_nul-firmado.pdf');
    expect(zipEntryNameFor('COM1.pdf')).toBe('_COM1-firmado.pdf');
    expect(zipEntryNameFor('LPT9.tar.pdf')).toBe('_LPT9.tar-firmado.pdf');
    // `CONTRATO` empieza por CON pero no es un dispositivo.
    expect(zipEntryNameFor('CONTRATO.pdf')).toBe('CONTRATO-firmado.pdf');
  });

  it('elimina caracteres de control y puntos/espacios al final', () => {
    const hostile = `recibo${String.fromCharCode(0, 9, 31, 127)}.pdf`;
    expect(zipEntryNameFor(hostile)).toBe('recibo-firmado.pdf');
    expect(zipEntryNameFor('recibo...   .pdf')).toBe('recibo-firmado.pdf');
    expect(zipEntryNameFor('   .pdf')).toBe('documento-firmado.pdf');
    expect(zipEntryNameFor('')).toBe('documento-firmado.pdf');
  });

  /**
   * QA post-merge 2026-08-03 (code-reviewer): controles bidi (U+202A-U+202E,
   * U+2066-U+2069) reordenan visualmente el nombre — "factura" + RLO (U+202E)
   * + "fdp.exe" se LEE "facturaexe.pdf" aunque el disfraz de extensión no
   * aplique aquí (la extensión real siempre se fuerza a `-firmado.pdf`); lo
   * que sí importa es que la UI de revisión pinta el nombre ANTES de firmar.
   */
  it('quita controles de dirección bidi (RLO/LRO/PDF/LRI/RLI/FSI/PDI)', () => {
    const rlo = '‮'; // Right-to-Left Override
    const pdf = '‬'; // Pop Directional Formatting
    expect(zipEntryNameFor(`factura${rlo}exe.pdf${pdf}.pdf`)).not.toContain(rlo);
    expect(stripControlChars(`a${rlo}b${pdf}c`)).toBe('abc');
  });

  it('recorta nombres larguísimos sin partir un carácter multibyte', () => {
    const name = zipEntryNameFor(`${'ñ'.repeat(400)}.pdf`);
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(200);
    expect(name.endsWith('-firmado.pdf')).toBe(true);
    expect(name).not.toContain('�');
  });
});

describe('colisiones', () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

  it('desambigua nombres repetidos en vez de pisarlos', () => {
    const w = new BatchZipWriter();
    expect(w.addPdf('informe.pdf', bytes)).toBe('informe-firmado.pdf');
    expect(w.addPdf('informe.pdf', bytes)).toBe('informe-firmado (2).pdf');
    expect(w.addPdf('informe.pdf', bytes)).toBe('informe-firmado (3).pdf');
    expect(w.entries).toHaveLength(3);
    expect(new Set(w.entries.map((e) => e.name)).size).toBe(3);
  });

  it('trata la colisión sin distinguir mayúsculas (Windows y macOS tampoco)', () => {
    const w = new BatchZipWriter();
    w.addPdf('Informe.pdf', bytes);
    expect(w.addPdf('INFORME.pdf', bytes)).toBe('INFORME-firmado (2).pdf');
  });

  it('desambigua también los nombres que colisionan sólo TRAS el saneado', () => {
    const w = new BatchZipWriter();
    w.addPdf('a:b.pdf', bytes);
    expect(w.addPdf('a?b.pdf', bytes)).toBe('a_b-firmado (2).pdf');
  });

  /**
   * QA post-merge 2026-08-03 (code-reviewer): `zipEntryNameFor` recorta el
   * nombre a `MAX_ENTRY_NAME_BYTES` (200), pero el sufijo de desambiguación
   * `#resolveUniqueName` se añadía DESPUÉS de ese recorte — un nombre largo
   * ya en el tope, al colisionar, salía por encima (medido: 200 → 204
   * bytes). Alcanzable con dos documentos de nombre largo idéntico en el
   * lote (caso central de esta feature: "contratos idénticos salvo el
   * nombre del firmante").
   */
  it('un nombre largo que colisiona sigue dentro de MAX_ENTRY_NAME_BYTES tras el sufijo', () => {
    const w = new BatchZipWriter();
    const longName = `${'a'.repeat(400)}.pdf`;
    const first = w.addPdf(longName, bytes);
    const second = w.addPdf(longName, bytes);
    expect(new TextEncoder().encode(first).length).toBeLessThanOrEqual(200);
    expect(new TextEncoder().encode(second).length).toBeLessThanOrEqual(200);
    expect(second).toContain('(2)');
    expect(second.endsWith('.pdf')).toBe(true);
    expect(first).not.toBe(second);
  });
});
