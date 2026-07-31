import { describe, expect, it } from 'vitest';
import { MAX_BATCH_FILES, MAX_BATCH_FILE_SIZE_BYTES } from '../workers/sign-queue';
import {
  BATCH_UI_MAX_FILES,
  EFFECTIVE_MAX_FILES,
  type RejectionReason,
  acceptFiles,
} from './preflight';

/** Un File del tamaño pedido sin reservar los bytes de verdad. */
function fakeFile(name: string, size: number, type = 'application/pdf'): File {
  const file = new File([new Uint8Array(0)], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

const ONE_MB = 1024 * 1024;

function reasons(rejected: readonly { reason: RejectionReason }[]): RejectionReason[] {
  return rejected.map((r) => r.reason);
}

describe('EFFECTIVE_MAX_FILES', () => {
  it('nunca supera lo que el motor acepta', () => {
    expect(EFFECTIVE_MAX_FILES).toBeLessThanOrEqual(MAX_BATCH_FILES);
  });

  it('es el tope de producto mientras sea el más bajo de los dos', () => {
    expect(EFFECTIVE_MAX_FILES).toBe(Math.min(BATCH_UI_MAX_FILES, MAX_BATCH_FILES));
  });
});

describe('acceptFiles', () => {
  it('acepta PDFs por debajo del límite', () => {
    const { accepted, rejected } = acceptFiles([fakeFile('a.pdf', ONE_MB)]);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it('acepta por extensión aunque el navegador no reporte el MIME', () => {
    const { accepted } = acceptFiles([fakeFile('sin-mime.PDF', ONE_MB, '')]);
    expect(accepted).toHaveLength(1);
  });

  it('rechaza lo que no es PDF nombrando el motivo', () => {
    const { accepted, rejected } = acceptFiles([fakeFile('foto.jpg', ONE_MB, 'image/jpeg')]);
    expect(accepted).toHaveLength(0);
    expect(reasons(rejected)).toEqual(['not_pdf']);
  });

  it('rechaza un archivo de 0 bytes por vacío, no por "no es PDF"', () => {
    const { rejected } = acceptFiles([fakeFile('vacio.pdf', 0)]);
    expect(reasons(rejected)).toEqual(['empty']);
  });

  it('rechaza el que supera el máximo por archivo', () => {
    const { rejected } = acceptFiles([fakeFile('enorme.pdf', MAX_BATCH_FILE_SIZE_BYTES + 1)]);
    expect(reasons(rejected)).toEqual(['file_too_large']);
  });

  it('acepta exactamente el tamaño máximo (el límite no es off-by-one)', () => {
    const { accepted } = acceptFiles([fakeFile('justo.pdf', MAX_BATCH_FILE_SIZE_BYTES)]);
    expect(accepted).toHaveLength(1);
  });

  it('corta en el tope y marca el sobrante como too_many', () => {
    const many = Array.from({ length: EFFECTIVE_MAX_FILES + 3 }, (_, i) =>
      fakeFile(`doc-${i}.pdf`, ONE_MB),
    );
    const { accepted, rejected } = acceptFiles(many);
    expect(accepted).toHaveLength(EFFECTIVE_MAX_FILES);
    expect(reasons(rejected)).toEqual(['too_many', 'too_many', 'too_many']);
  });

  it('cuenta los ya elegidos: el tope es del lote, no de cada tanda', () => {
    const first = acceptFiles(
      Array.from({ length: EFFECTIVE_MAX_FILES }, (_, i) => fakeFile(`a-${i}.pdf`, ONE_MB)),
    );
    expect(first.accepted).toHaveLength(EFFECTIVE_MAX_FILES);

    // Segunda tanda con el lote ya lleno: nada entra, y se dice por qué.
    const second = acceptFiles([fakeFile('extra.pdf', ONE_MB)], first.accepted.length);
    expect(second.accepted).toHaveLength(0);
    expect(reasons(second.rejected)).toEqual(['too_many']);
  });

  it('no descarta en silencio: todo archivo sale aceptado o rechazado', () => {
    const input = [
      fakeFile('ok.pdf', ONE_MB),
      fakeFile('foto.png', ONE_MB, 'image/png'),
      fakeFile('vacio.pdf', 0),
      fakeFile('gordo.pdf', MAX_BATCH_FILE_SIZE_BYTES + 1),
    ];
    const { accepted, rejected } = acceptFiles(input);
    expect(accepted.length + rejected.length).toBe(input.length);
  });

  it('conserva el orden en que se soltaron', () => {
    const { accepted } = acceptFiles([
      fakeFile('1.pdf', ONE_MB),
      fakeFile('2.pdf', ONE_MB),
      fakeFile('3.pdf', ONE_MB),
    ]);
    expect(accepted.map((f) => f.name)).toEqual(['1.pdf', '2.pdf', '3.pdf']);
  });
});
