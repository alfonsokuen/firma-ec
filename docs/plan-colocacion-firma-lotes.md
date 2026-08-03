# Colocación de la firma en lotes — especificación

> Estado: **diseño acordado, sin implementar**. Rama `feat/firma-por-lotes-nucleo`.
> Decisión del usuario (2026-07-31): diseñar la mejor colocación propia, y **cuando el
> sistema no esté seguro, ofrecer vista previa de ESE documento**. La vista previa es
> la excepción, no el paso obligatorio.

## Por qué no basta con lo que hay

Lo actual resuelve, en orden: campo de firma declarado → anti-solape contra firmas
previas → primer hueco libre de la última página → pie de página. Desde `019ec53` el
hueco se busca con las bandas de texto reales (CTM aplicada). Funciona, pero **decide
siempre en silencio**: no distingue "esto es obvio" de "esto es un empate a cara o
cruz", y el usuario solo se entera al abrir el ZIP.

## Lo medido (no suponer, está comprobado)

Corpus A — 18 fixtures del repo (`packages/verifier/tests/fixtures` + e2e):

- Sin bandas de texto, la colocación es **idéntica** al algoritmo anterior a `485cc3e`:
  0 de 18 de deriva. Es el candado de `textBandsPlacement.test.ts`.
- La colocación ANTERIOR caía **dentro de un bloque de texto** en `audit-075-firmado`,
  `eci-real-signed` y `eci-real-contrato2026`. Ya no.
- `carta-arrendamiento-firmado` se aparta con `no_free_slot` y es correcto: huecos
  máximos de 30 pt para una estampa de 72.

Corpus B — 12 documentos reales del usuario (contratos, actas, escritos):

- **Los 12 tienen texto extraíble** (23–350 fragmentos en la última página). Ninguno es
  escaneo puro.
- **`f)` y `Firma:` no aparecen NI UNA VEZ.** La suposición de partida era falsa.
- `rol-parte` (arrendador/contratante/…) dispara en 10 de 12, **pero también en el
  cuerpo del contrato**: la palabra sale decenas de veces. Que la coincidencia más baja
  acierte es maquetación, no lógica.
- `075-2026.pdf` tiene el bloque de firma en las páginas **2 y 3, no en la última**.
  ⇒ el supuesto "se firma en la última página" es falso y hay que poder elegir página.
- `BusqFon_IDKMANAGER.pdf` (13 pág.) **no tiene bloque de firma en ninguna página**: es
  un informe. Para estos el pie de página es la respuesta correcta.

Conclusión: el anclaje semántico **no puede ser el mecanismo principal**. Entra como
desempate entre huecos ya válidos, donde no puede empeorar nada.

## Diseño

### 1. Cascada de colocación (de más fiable a menos)

| # | Fuente | Confianza |
|---|--------|-----------|
| 1 | Campo de firma declarado (`/FT /Sig` sin `/V`) | **alta** — lo pide el documento |
| 2 | Hueco libre único y holgado, lejos del texto | **alta** |
| 3 | Hueco libre elegido entre varios, desempatado por ancla | **media** |
| 4 | Anti-solape contra firmas previas | media / alta según holgura |
| 5 | Pie de página en documento sin bloque de firma | **alta** si la página está limpia |
| 6 | Nada de lo anterior | **baja** → vista previa obligatoria |

### 2. La confianza es el corazón, y hay que medirla

`computeAutoPlacement` debe devolver `confidence: 'alta' | 'media' | 'baja'` junto al
rect. Señales que la bajan:

- página **no analizada** (`unanalyzedPages`) → nunca superior a media
- holgura al texto/firma más cercana < `GAP` → media
- más de un hueco válido con puntuación parecida → media
- ancla de firma detectada en una página **distinta** a la elegida → media
- rotación ≠ 0, CropBox desplazado, o página más pequeña que la estampa → baja
- `needs_review` de hoy → baja (ya no aparta: ofrece colocar a mano)

⚠️ **Regla de `testing.md`, obligatoria aquí**: cambiar un clasificador es un trade
bidireccional. El corpus de calibración necesita **≥5 casos que deben salir "alta" y ≥5
que deben salir "baja"**, y el test afirma las dos direcciones. Subir la confianza para
que no moleste silencia justo los casos que la vista previa existe para cazar.

### 3. Flujo

- Paso 2 (revisión) muestra por documento: página, origen y **confianza**.
- Confianza **alta** → nada que hacer, sigue automático.
- Confianza **media/baja** → botón "Ver y ubicar" que abre la vista previa **de ese
  documento**: página renderizada (`PdfPreview`, ya existe), caja encima, mover con la
  rejilla de 6 zonas (`SimplePlacer`) o arrastre (`BoxPlacer`), y selector de página.
- Opcional, si el usuario lo pide: "aplicar esta posición a los demás dudosos".
- Nunca se firma un documento de confianza baja sin que una persona lo haya visto.

### 4. Restricciones que no se negocian

- **Todo en el dispositivo.** Nada de IA en la nube: el documento no sale. Descartado
  también el modelo local (100–400 MB, y no acierta más que lo de arriba en documentos
  tan convencionales).
- **Cero telemetría.** Ni el nombre del documento ni la cédula a consola, `Error`,
  `localStorage` o red. El texto se lee **solo** en memoria para desempatar.
- **No tocar `sw.ts`** ni la estrategia de caché del Service Worker.
- La equivalencia "sin bandas ⇒ comportamiento de siempre" (0/18) **se mantiene**.

## Orden de trabajo

0. Leer el fuente de FirmaEC ([MINKA](https://minka.gob.ec/mintel/ge/firmaec)) y
   documentar su regla de colocación **con archivo y línea**. Puede cambiar el punto 1.
   Ojo: FirmaEC firma de uno en uno con una persona delante — resuelve otro problema.
1. `confidence` en `computeAutoPlacement` + corpus bidireccional de calibración.
2. Vista previa por documento en el paso 2 (reutilizar `PdfPreview` + `SimplePlacer`).
3. Selector de página (caso `075-2026`).
4. Ancla como desempate, nunca como decisión.
5. "Aplicar a los demás dudosos".

## Pendiente de verificación del usuario

- Volver a firmar sus tres contratos con `019ec53`/`d95253e` y decir dónde cayó.
- "Validar certificado" con su `.p12`: si la cédula no resuelve, falta el arco OID de su
  ACE (hay 5 mapeadas: ICERT-EC, ArgosData, Security Data, BCE, Uanataca).
