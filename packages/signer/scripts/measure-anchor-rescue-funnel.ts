/**
 * measure-anchor-rescue-funnel.ts — sobre los documentos del corpus real que
 * HOY quedan `no_free_slot` (sin ancla activa, pipeline FASE 2), mide el
 * embudo del rescate por ancla genérica (`rescueWithGenericAnchor`,
 * `autoPlacement.ts`):
 *
 *   no_free_slot → ¿ancla presente? → ¿misma página o distinta? →
 *   ¿hay huecos enumerados en la página del ancla? → Δv al más cercano →
 *   ¿Δv ≤ 144pt (2×boxH, `ANCHOR_RESCUE_TOLERANCE_PT`)? → rescatable
 *
 * Solo lee *.pdf (nunca *.p12, nunca los abre ni los copia ni imprime su
 * contenido — únicamente cuenta y mide distancias en puntos). `anchorSpec`
 * va vacío por la misma razón que en `measure-anchor-corpus.ts`: no hay
 * nombre/cédula real seguro que usar en un corpus mixto, así que solo se
 * activa la detección de etiqueta GENÉRICA.
 *
 * Ejecutar con:
 *   node --experimental-strip-types scripts/measure-anchor-rescue-funnel.ts
 * (requiere `npm run build` primero — importa de `../dist`, igual que
 * `measure-anchor-corpus.ts`.)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { analyzePdfForPlacement } from '../dist/analyzePdf.js';
import { computeAnchorPlacement } from '../dist/anchorPlacement.js';
import {
  type AnchorPlacementHint,
  DEFAULT_SIG_BOX_H,
  computeAutoPlacement,
  nearestRescueSlotDeltaV,
} from '../dist/autoPlacement.js';

const ROOTS = [
  'C:\\Users\\alfon\\Nextcloud\\Documentos',
  'C:\\Users\\alfon\\OneDrive\\Desktop',
  'C:\\Users\\alfon\\Downloads',
  'C:\\Users\\alfon\\OneDrive\\Desktop\\.p12 kevin',
];

const RESCUE_TOLERANCE_PT = 2 * DEFAULT_SIG_BOX_H; // = ANCHOR_RESCUE_TOLERANCE_PT

function findPdfs(root: string, out: string[], depth = 0): void {
  if (depth > 6) return;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(root, entry);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) findPdfs(full, out, depth + 1);
    else if (st.isFile() && entry.toLowerCase().endsWith('.pdf')) out.push(full);
  }
}

async function main(): Promise<void> {
  const all: string[] = [];
  for (const root of ROOTS) findPdfs(root, all);
  const unique = [...new Set(all)];

  console.log(`Corpus: ${unique.length} PDF(s) encontrados bajo ${ROOTS.length} raíces.`);

  let noFreeSlotTotal = 0;
  let conAncla = 0;
  let anclaMismaPagina = 0;
  let anclaOtraPagina = 0;
  let conHuecosEnumerados = 0;
  let sinHuecosEnumerados = 0;
  let rescatables = 0;
  let noRescatables = 0;
  const deltas: number[] = [];
  let errors = 0;

  for (const [i, file] of unique.entries()) {
    try {
      const bytes = new Uint8Array(readFileSync(file));

      // Línea base FASE 2 (sin ancla): ¿este documento es de los que hoy
      // quedan `no_free_slot`?
      const base = await analyzePdfForPlacement(bytes);
      const placementBase = computeAutoPlacement({
        geometry: base.geometry,
        existing: base.existing,
        emptySigFields: base.emptySigFields,
        textBands: base.textBands,
        unanalyzedPages: base.unanalyzedPages,
        ...(base.failure ? { failure: base.failure } : {}),
      });
      if (placementBase.status !== 'needs_review' || placementBase.reason !== 'no_free_slot') {
        continue;
      }
      noFreeSlotTotal++;

      // ¿Hay ancla genérica en este documento?
      const withAnchor = await analyzePdfForPlacement(bytes, { anchorSpec: {} });
      const choice = withAnchor.anchors
        ? computeAnchorPlacement(withAnchor.anchors.hits, withAnchor.geometry)
        : undefined;
      if (!choice) continue;
      conAncla++;

      const sourcePage = placementBase.page;
      if (choice.page === sourcePage) anclaMismaPagina++;
      else anclaOtraPagina++;

      const anchor: AnchorPlacementHint = {
        page: choice.page,
        preferredV: choice.preferredV,
        preferredU: choice.preferredU,
        kind: choice.kind,
      };
      const { slotsEnumerated, deltaV } = nearestRescueSlotDeltaV(
        anchor,
        withAnchor.geometry,
        withAnchor.existing,
        withAnchor.textBands,
      );

      if (slotsEnumerated === 0 || deltaV === null) {
        sinHuecosEnumerados++;
        continue;
      }
      conHuecosEnumerados++;
      deltas.push(deltaV);
      if (deltaV <= RESCUE_TOLERANCE_PT) rescatables++;
      else noRescatables++;
    } catch (err) {
      errors++;
      console.error(`  ! error en ${file}: ${(err as Error).message}`);
    }
    if ((i + 1) % 25 === 0) console.log(`  ... ${i + 1}/${unique.length}`);
  }

  deltas.sort((a, b) => a - b);
  const median = deltas.length > 0 ? deltas[Math.floor(deltas.length / 2)]! : null;
  const p90 = deltas.length > 0 ? deltas[Math.floor(deltas.length * 0.9)]! : null;

  console.log('\n=== Embudo del rescate por ancla genérica (sobre no_free_slot de FASE 2) ===');
  console.log(`  no_free_slot (línea base, sin ancla): ${noFreeSlotTotal}`);
  console.log(
    `  con ancla genérica presente: ${conAncla} (${noFreeSlotTotal > 0 ? ((100 * conAncla) / noFreeSlotTotal).toFixed(1) : 'n/a'}%)`,
  );
  console.log(`    ancla en la MISMA página que el no_free_slot: ${anclaMismaPagina}`);
  console.log(`    ancla en OTRA página: ${anclaOtraPagina}`);
  console.log(`  con al menos 1 hueco enumerado en la página del ancla: ${conHuecosEnumerados}`);
  console.log(`  sin ningún hueco enumerado en la página del ancla: ${sinHuecosEnumerados}`);
  console.log(
    `  Δv al hueco más cercano — mediana: ${median?.toFixed(1) ?? 'n/a'}pt · p90: ${p90?.toFixed(1) ?? 'n/a'}pt`,
  );
  console.log(
    `  rescatables (Δv ≤ ${RESCUE_TOLERANCE_PT}pt): ${rescatables} de ${conHuecosEnumerados}`,
  );
  console.log(`  NO rescatables (Δv > ${RESCUE_TOLERANCE_PT}pt): ${noRescatables}`);
  console.log(`  errores de lectura: ${errors}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
