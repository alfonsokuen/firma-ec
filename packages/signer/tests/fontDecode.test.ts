/**
 * fontDecode.test.ts — cubre la decodificación de cadenas PDF a code points y,
 * sobre todo, el invariante de privacidad: ningún carácter del documento puede
 * escapar del módulo por ninguna vía que no sea el sink transitorio.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_TOTAL_MAP_ENTRIES,
  UNMAPPED_CODE_POINT,
  createCoverageTracker,
  createSimpleFontDecoder,
  createToUnicodeDecoder,
  type CodePointSink,
  type DecodeOutcome,
} from '../src/fontDecode.js';

function collect(bytes: Uint8Array, decoder: { decode(b: Uint8Array, s: CodePointSink): DecodeOutcome }) {
  const cps: number[] = [];
  const outcome = decoder.decode(bytes, (cp) => {
    cps.push(cp);
  });
  return { cps, outcome };
}

/** Construye la representación UTF-16BE en hex de un code point BMP. */
function utf16beHex(cp: number): string {
  return cp.toString(16).padStart(4, '0');
}

describe('createSimpleFontDecoder — WinAnsi', () => {
  it('decodifica "Pérez" (con é en 0xE9)', () => {
    const decoder = createSimpleFontDecoder({ baseEncoding: 'WinAnsi' });
    const bytes = new Uint8Array([0x50, 0xe9, 0x72, 0x65, 0x7a]); // P é r e z
    const { cps, outcome } = collect(bytes, decoder);
    expect(cps).toEqual([0x50, 0xe9, 0x72, 0x65, 0x7a]);
    expect(outcome).toEqual({ codes: 5, mapped: 5 });
  });

  it('0xA9 (©), fuera del allowlist, sale UNMAPPED', () => {
    const decoder = createSimpleFontDecoder({ baseEncoding: 'WinAnsi' });
    const { cps, outcome } = collect(new Uint8Array([0x41, 0xa9, 0x42]), decoder);
    expect(cps).toEqual([0x41, UNMAPPED_CODE_POINT, 0x42]);
    expect(outcome.codes).toBe(3);
    expect(outcome.mapped).toBeLessThan(outcome.codes);
    expect(outcome.mapped).toBe(2);
  });
});

describe('createSimpleFontDecoder — MacRoman', () => {
  it('decodifica á/é/ñ con los bytes de su tabla propia', () => {
    const decoder = createSimpleFontDecoder({ baseEncoding: 'MacRoman' });
    // á=0x87 é=0x8E ñ=0x96
    const { cps, outcome } = collect(new Uint8Array([0x87, 0x8e, 0x96]), decoder);
    expect(cps).toEqual([0xe1, 0xe9, 0xf1]); // á é ñ
    expect(outcome).toEqual({ codes: 3, mapped: 3 });
  });

  it('Á/É/Ñ/Ü mayúsculas con sus bytes propios', () => {
    const decoder = createSimpleFontDecoder({ baseEncoding: 'MacRoman' });
    // Á=0xE7 É=0x83 Ñ=0x84 Ü=0x86
    const { cps } = collect(new Uint8Array([0xe7, 0x83, 0x84, 0x86]), decoder);
    expect(cps).toEqual([0xc1, 0xc9, 0xd1, 0xdc]);
  });
});

describe('createSimpleFontDecoder — Standard', () => {
  it('el subconjunto ASCII pasa igual que en cualquier otra base', () => {
    const decoder = createSimpleFontDecoder({ baseEncoding: 'Standard' });
    const bytes = new TextEncoder().encode('Juan_Perez.pdf');
    const { outcome } = collect(bytes, decoder);
    expect(outcome).toEqual({ codes: bytes.length, mapped: bytes.length });
  });

  it('0xE9 sin /Differences sale UNMAPPED (Standard no tiene acentuados precompuestos)', () => {
    const decoder = createSimpleFontDecoder({ baseEncoding: 'Standard' });
    const { cps, outcome } = collect(new Uint8Array([0xe9]), decoder);
    expect(cps).toEqual([UNMAPPED_CODE_POINT]);
    expect(outcome).toEqual({ codes: 1, mapped: 0 });
  });
});

describe('createSimpleFontDecoder — /Differences', () => {
  it('mapea 233→é y 241→ñ; un nombre fuera de la lista queda unmapped', () => {
    const decoder = createSimpleFontDecoder({
      baseEncoding: 'Standard',
      differences: [233, 'eacute', 241, 'ntilde', 45, 'copyright'],
    });
    const { cps, outcome } = collect(new Uint8Array([233, 241, 45]), decoder);
    expect(cps).toEqual([0xe9, 0xf1, UNMAPPED_CODE_POINT]);
    expect(outcome).toEqual({ codes: 3, mapped: 2 });
  });

  it('una entrada de /Differences pisa lo que hubiera en la tabla base', () => {
    // 0x2d ('-') está en el allowlist ASCII; /Differences lo redefine a 'A'.
    const decoder = createSimpleFontDecoder({
      baseEncoding: 'Standard',
      differences: [0x2d, 'A'],
    });
    const { cps } = collect(new Uint8Array([0x2d]), decoder);
    expect(cps).toEqual([0x41]);
  });
});

describe('createToUnicodeDecoder — bfchar', () => {
  it('bfchar 2-byte simple', () => {
    const cmap = new TextEncoder().encode(
      `2 beginbfchar\n<0041> <0041>\n<0042> <0042>\nendbfchar`,
    );
    const decoder = createToUnicodeDecoder(cmap);
    const { cps, outcome } = collect(new Uint8Array([0x00, 0x41, 0x00, 0x42]), decoder);
    expect(cps).toEqual([0x41, 0x42]);
    expect(outcome).toEqual({ codes: 2, mapped: 2 });
  });

  it('bfchar con dst multi-code-point (ligadura ffi → 3 cps)', () => {
    // ffi = U+0066 U+0066 U+0069
    const cmap = new TextEncoder().encode(`1 beginbfchar\n<0001> <006600660069>\nendbfchar`);
    const decoder = createToUnicodeDecoder(cmap);
    const { cps, outcome } = collect(new Uint8Array([0x00, 0x01]), decoder);
    expect(cps).toEqual([0x66, 0x66, 0x69]);
    expect(outcome).toEqual({ codes: 1, mapped: 1 });
  });

  it('dst con surrogate pair combina en UN solo code point', () => {
    // U+1F600 (😀) = surrogates D83D DE00
    const cmap = new TextEncoder().encode(`1 beginbfchar\n<0001> <d83dde00>\nendbfchar`);
    const decoder = createToUnicodeDecoder(cmap);
    const { cps, outcome } = collect(new Uint8Array([0x00, 0x01]), decoder);
    expect(cps).toEqual([0x1f600]);
    expect(outcome).toEqual({ codes: 1, mapped: 1 });
  });
});

describe('createToUnicodeDecoder — bfrange', () => {
  it('forma incremental <lo> <hi> <dst>', () => {
    const cmap = new TextEncoder().encode(`1 beginbfrange\n<0001> <0003> <0041>\nendbfrange`);
    const decoder = createToUnicodeDecoder(cmap);
    const { cps, outcome } = collect(
      new Uint8Array([0x00, 0x01, 0x00, 0x02, 0x00, 0x03]),
      decoder,
    );
    expect(cps).toEqual([0x41, 0x42, 0x43]);
    expect(outcome).toEqual({ codes: 3, mapped: 3 });
  });

  it('forma array <lo> <hi> [<d1> <d2> …]', () => {
    const cmap = new TextEncoder().encode(
      `1 beginbfrange\n<0001> <0003> [<0041> <0058> <005a>]\nendbfrange`,
    );
    const decoder = createToUnicodeDecoder(cmap);
    const { cps, outcome } = collect(
      new Uint8Array([0x00, 0x01, 0x00, 0x02, 0x00, 0x03]),
      decoder,
    );
    expect(cps).toEqual([0x41, 0x58, 0x5a]);
    expect(outcome).toEqual({ codes: 3, mapped: 3 });
  });

  it('CMap malformada/truncada nunca lanza; todo sale unmapped', () => {
    const cmap = new TextEncoder().encode(`1 beginbfrange\n<0001> <0003 <0041\nendbfra`);
    expect(() => createToUnicodeDecoder(cmap)).not.toThrow();
    const decoder = createToUnicodeDecoder(cmap);
    let threw = false;
    let outcome: DecodeOutcome | undefined;
    try {
      outcome = decoder.decode(new Uint8Array([0x00, 0x01, 0x00, 0x02]), () => {});
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(outcome).toBeDefined();
    expect(outcome!.mapped).toBe(0);
  });

  it('longitud impar con códigos 2-byte: el resto cuenta como 1 código unmapped', () => {
    const cmap = new TextEncoder().encode(`1 beginbfchar\n<0041> <0041>\nendbfchar`);
    const decoder = createToUnicodeDecoder(cmap);
    const { cps, outcome } = collect(new Uint8Array([0x00, 0x41, 0x00]), decoder);
    expect(cps).toEqual([0x41, UNMAPPED_CODE_POINT]);
    expect(outcome).toEqual({ codes: 2, mapped: 1 });
  });

  it('respeta /begincodespacerange para derivar la longitud de código', () => {
    const cmap = new TextEncoder().encode(
      `1 begincodespacerange\n<00> <ff>\nendcodespacerange\n1 beginbfchar\n<41> <0041>\nendbfchar`,
    );
    const decoder = createToUnicodeDecoder(cmap);
    const { cps, outcome } = collect(new Uint8Array([0x41, 0x42]), decoder);
    expect(cps).toEqual([0x41, UNMAPPED_CODE_POINT]);
    expect(outcome).toEqual({ codes: 2, mapped: 1 });
  });
});

describe('createCoverageTracker', () => {
  it('calcula la fracción exacta de ops totalmente mapeadas', () => {
    const tracker = createCoverageTracker();
    tracker.recordOp({ codes: 5, mapped: 5 }); // mapeada
    tracker.recordOp({ codes: 4, mapped: 2 }); // parcial: NO cuenta
    tracker.recordOp({ codes: 3, mapped: 0 }); // nada mapeado: NO cuenta
    tracker.recordOp({ codes: 0, mapped: 0 }); // cadena vacía: SÍ cuenta
    expect(tracker.ops).toBe(4);
    expect(tracker.mappedOps).toBe(2);
    expect(tracker.decodeCoverage).toBeCloseTo(0.5);
  });

  it('ops === 0 → decodeCoverage === 1 (no hay ancla, no "no pude leer")', () => {
    const tracker = createCoverageTracker();
    expect(tracker.ops).toBe(0);
    expect(tracker.decodeCoverage).toBe(1);
  });
});

describe('privacidad — nada del documento sale por otra vía que el sink', () => {
  const SECRET = 'SECRETO CONFIDENCIAL';

  function secretBytesWinAnsi(): Uint8Array {
    return new TextEncoder().encode(SECRET);
  }

  function secretToUnicodeSetup(): { cmap: Uint8Array; bytes: Uint8Array } {
    // CMap ad-hoc: cada carácter de SECRET es un código de 1 byte i → su
    // propio code point, vía bfchar.
    const chars = Array.from(SECRET);
    const lines = chars
      .map((ch, i) => `<${i.toString(16).padStart(2, '0')}> <${utf16beHex(ch.codePointAt(0)!)}>`)
      .join('\n');
    const cmap = new TextEncoder().encode(`${chars.length} beginbfchar\n${lines}\nendbfchar`);
    const bytes = new Uint8Array(chars.length);
    chars.forEach((_, i) => {
      bytes[i] = i;
    });
    return { cmap, bytes };
  }

  function assertNoStringLeak(value: unknown, secret: string): void {
    // (a) JSON.stringify no debe contener ninguna subcadena de ≥3 chars del secreto.
    const json = JSON.stringify(value);
    for (let i = 0; i + 3 <= secret.length; i++) {
      const chunk = secret.slice(i, i + 3);
      expect(json).not.toContain(chunk);
    }

    // (b) walk recursivo de own properties (incl. getters): cero valores string.
    const seen = new Set<unknown>();
    const stack: unknown[] = [value];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === null || current === undefined) continue;
      if (typeof current === 'string') {
        throw new Error('valor string encontrado en un objeto devuelto por fontDecode');
      }
      // Las funciones (p.ej. `recordOp`) son métodos, no datos: se verifica que
      // el valor en sí no sea un string, pero no se recorre su metadata
      // intrínseca (`fn.name`, `fn.length`) — eso es ruido del lenguaje, no una
      // fuga del documento.
      if (typeof current === 'function') continue;
      if (typeof current !== 'object') continue;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const key of Object.getOwnPropertyNames(current)) {
        let propValue: unknown;
        try {
          propValue = (current as Record<string, unknown>)[key];
        } catch {
          continue;
        }
        stack.push(propValue);
      }
    }
  }

  it('WinAnsi: outcome/tracker no exponen el secreto ni como string', () => {
    const decoder = createSimpleFontDecoder({ baseEncoding: 'WinAnsi' });
    const tracker = createCoverageTracker();
    const outcome = decoder.decode(secretBytesWinAnsi(), () => {});
    tracker.recordOp(outcome);

    assertNoStringLeak(outcome, SECRET);
    assertNoStringLeak(tracker, SECRET);
  });

  it('ToUnicode: outcome/tracker no exponen el secreto ni como string', () => {
    const { cmap, bytes } = secretToUnicodeSetup();
    const decoder = createToUnicodeDecoder(cmap);
    const tracker = createCoverageTracker();
    const outcome = decoder.decode(bytes, () => {});
    tracker.recordOp(outcome);

    assertNoStringLeak(outcome, SECRET);
    assertNoStringLeak(tracker, SECRET);
  });

  it('un sink que devuelve strings no cambia el resultado frente a un sink void', () => {
    const decoder = createSimpleFontDecoder({ baseEncoding: 'WinAnsi' });
    const bytes = secretBytesWinAnsi();

    const voidCps: number[] = [];
    const voidOutcome = decoder.decode(bytes, (cp) => {
      voidCps.push(cp);
    });

    const maliciousCps: number[] = [];
    // Un sink que devuelve un valor sigue siendo asignable a `CodePointSink`
    // (el retorno `void` de TS no impide que la implementación devuelva algo);
    // el punto del test es que el decoder ignora ese valor de todos modos.
    const maliciousOutcome = decoder.decode(bytes, (cp) => {
      maliciousCps.push(cp);
      return 'exfiltrado';
    });

    expect(maliciousCps).toEqual(voidCps);
    expect(maliciousOutcome).toEqual(voidOutcome);
  });

  it('console.* nunca se llama durante decode', () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'debug').mockImplementation(() => {}),
    ];
    try {
      const decoder = createSimpleFontDecoder({ baseEncoding: 'WinAnsi' });
      decoder.decode(secretBytesWinAnsi(), () => {});
      const { cmap, bytes } = secretToUnicodeSetup();
      createToUnicodeDecoder(cmap).decode(bytes, () => {});
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('MAX_TOTAL_MAP_ENTRIES — el techo AGREGADO, no solo el de un bloque (mutación #2)', () => {
  /**
   * `MAX_RANGE_SIZE` acota un solo `beginbfrange…endbfrange`, pero nada
   * impedía encadenar miles de bloques, cada uno bajo su propio tope
   * individual, para acumular escrituras sin límite (medido: 52.105 rangos
   * × 65.536 entradas = 3,4e9 `map.set`). Se reproduce la FORMA del ataque a
   * escala de test: muchos bloques PEQUEÑOS (64 entradas cada uno, muy por
   * debajo de `MAX_RANGE_SIZE`) que en conjunto SUMAN más que
   * `MAX_TOTAL_MAP_ENTRIES`. Sin el tope agregado, la última entrada
   * decodifica igual que la primera; con él, se corta a mitad de camino.
   */
  it('bloques bfrange pequeños que en conjunto superan el tope: el código de un bloque NUEVO tras agotarlo queda sin mapear', () => {
    // Los códigos fuente son de 16 bits (2 bytes): no hay 65.536+1 códigos
    // DISTINTOS posibles para forzar el agotamiento con códigos únicos. El
    // ataque real tampoco los necesita — reescribe el MISMO rango una y otra
    // vez, y cada `map.set` gasta presupuesto exista o no la clave ya
    // (`setBounded` decuenta SIEMPRE). Se reproduce así: muchos bloques
    // PEQUEÑOS (64 entradas, muy por debajo de `MAX_RANGE_SIZE`) reescriben
    // el mismo rango [0x0000, 0x003F] hasta agotar exactamente el
    // presupuesto agregado, y DESPUÉS llega un bloque para un código NUEVO
    // (0x03E8, nunca antes visto) que ya no puede escribirse.
    const ENTRIES_PER_BLOCK = 64;
    const fillerBlockCount = MAX_TOTAL_MAP_ENTRIES / ENTRIES_PER_BLOCK; // agota el presupuesto EXACTO
    expect(Number.isInteger(fillerBlockCount)).toBe(true);

    const fillerBlock = (generation: number): string => {
      const dsts = Array.from(
        { length: ENTRIES_PER_BLOCK },
        (_, i) => `<${utf16beHex(0x4000 + ((generation + i) % 0x0800))}>`,
      ).join(' ');
      return `1 beginbfrange\n<0000> <003f> [${dsts}]\nendbfrange`;
    };
    const blocks: string[] = [];
    for (let b = 0; b < fillerBlockCount; b++) blocks.push(fillerBlock(b));
    // Bloque NUEVO, para un código jamás escrito antes: llega DESPUÉS de
    // agotar el presupuesto agregado.
    const NEW_CODE = 0x03e8;
    blocks.push(
      `1 beginbfrange\n<${utf16beHex(NEW_CODE)}> <${utf16beHex(NEW_CODE + 63)}> <7000>\nendbfrange`,
    );
    const cmap = new TextEncoder().encode(blocks.join('\n'));

    const decoder = createToUnicodeDecoder(cmap);

    // El código 0x0000, reescrito por CADA bloque relleno, sí se mapeó — el
    // presupuesto se gastó, pero antes de agotarse escribió con normalidad.
    const early = collect(new Uint8Array([0x00, 0x00]), decoder);
    expect(early.outcome.mapped).toBe(1);
    expect(early.cps[0]).not.toBe(UNMAPPED_CODE_POINT);

    // El código NUEVO del último bloque nunca llegó a escribirse: sin el
    // tope AGREGADO (solo con `MAX_RANGE_SIZE`, que cada bloque individual
    // respeta de sobra con 64 entradas) sí mapearía.
    const late = collect(new Uint8Array([(NEW_CODE >> 8) & 0xff, NEW_CODE & 0xff]), decoder);
    expect(late.outcome.mapped).toBe(0);
    expect(late.cps[0]).toBe(UNMAPPED_CODE_POINT);
  });
});
