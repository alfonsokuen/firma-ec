/**
 * measure-anchor-corpus.ts — mide el impacto de la FASE 3 (ancla de texto)
 * sobre PDFs REALES del usuario. Ejecutar con:
 *   node --experimental-strip-types scripts/measure-anchor-corpus.ts
 *
 * Solo lee *.pdf (nunca *.p12, nunca los abre ni los copia). No hay
 * `signerName`/`cedula` reales disponibles con seguridad para este corpus
 * mixto (no son documentos de un firmante conocido) — así que el
 * `anchorSpec` va VACÍO: solo se activa la detección de etiqueta GENÉRICA
 * ("Firma"/"f)"/"firmado por"), nunca `firmante-nombre`/`firmante-cedula`
 * (que exigen un valor con el que comparar y aquí no hay ninguno seguro que
 * usar). Es la medida honesta que se puede hacer sin inventar datos
 * personales: cuántos de los documentos que hoy se apartan tienen, al menos,
 * una etiqueta de firma que el ancla genérica pueda aprovechar.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { analyzePdfForPlacement } from '../dist/analyzePdf.js';
import { computeAnchorPlacement } from '../dist/anchorPlacement.js';
import { type AnchorPlacementHint, computeAutoPlacement } from '../dist/autoPlacement.js';
import { classifyPlacement } from '../dist/placementConfidence.js';

const ROOTS = [
  'C:\\Users\\alfon\\Nextcloud\\Documentos',
  'C:\\Users\\alfon\\OneDrive\\Desktop',
  'C:\\Users\\alfon\\Downloads',
  'C:\\Users\\alfon\\OneDrive\\Desktop\\.p12 kevin',
];

function findPdfs(root: string, out: string[], depth = 0): void {
  if (depth > 6) return; // corta ciclos/symlinks raros y no se pierde en árboles absurdos
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return; // carpeta inexistente o sin permiso: se salta, no revienta el barrido
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

  let placedNoAnchor = 0;
  let placedWithAnchor = 0;
  let altaNoAnchor = 0;
  let altaWithAnchor = 0;
  let closedByAnchor = 0; // sin colocación → con colocación gracias al ancla
  const reasonCounts = new Map<string, number>();
  let errors = 0;

  // Salvaguarda del rescate por ancla genérica (2026-08): el rescate NUNCA
  // debe desplazar una colocación que YA funcionaba por su cuenta —solo entra
  // cuando el pipeline normal dijo `no_free_slot`—, así que para todo
  // documento que en la línea base ya salía `status:'ok'`, el rect (página,
  // x, y) debe salir IDÉNTICO con el ancla conectada. Cualquier delta aquí es
  // una regresión real, no ruido de medición.
  let alreadyOkChecked = 0;
  let rectUnchanged = 0;
  const rectChanged: string[] = [];

  for (const [i, file] of unique.entries()) {
    try {
      const bytes = new Uint8Array(readFileSync(file));

      const noAnchor = await analyzePdfForPlacement(bytes);
      const placementNoAnchor = computeAutoPlacement({
        geometry: noAnchor.geometry,
        existing: noAnchor.existing,
        emptySigFields: noAnchor.emptySigFields,
        textBands: noAnchor.textBands,
        unanalyzedPages: noAnchor.unanalyzedPages,
        ...(noAnchor.failure ? { failure: noAnchor.failure } : {}),
      });
      const confNoAnchor = classifyPlacement({
        placement: placementNoAnchor,
        geometry: noAnchor.geometry,
        textBands: noAnchor.textBands,
        unanalyzedPages: noAnchor.unanalyzedPages,
        imageOnlyPages: noAnchor.imageOnlyPages,
        ocrOnlyPages: noAnchor.ocrOnlyPages,
      });
      if (placementNoAnchor.status === 'ok') {
        placedNoAnchor++;
        if (confNoAnchor.level === 'alta') altaNoAnchor++;
      }

      const withAnchor = await analyzePdfForPlacement(bytes, { anchorSpec: {} });
      const choice = withAnchor.anchors
        ? computeAnchorPlacement(withAnchor.anchors.hits, withAnchor.geometry)
        : undefined;
      const anchor: AnchorPlacementHint | undefined = choice
        ? {
            page: choice.page,
            preferredV: choice.preferredV,
            preferredU: choice.preferredU,
            kind: choice.kind,
          }
        : undefined;
      const placementWithAnchor = computeAutoPlacement({
        geometry: withAnchor.geometry,
        existing: withAnchor.existing,
        emptySigFields: withAnchor.emptySigFields,
        textBands: withAnchor.textBands,
        unanalyzedPages: withAnchor.unanalyzedPages,
        ...(withAnchor.failure ? { failure: withAnchor.failure } : {}),
        ...(anchor ? { anchor } : {}),
      });
      const coverage = choice
        ? (withAnchor.anchors?.pageStats.find((s) => s.page === choice.page)?.coverage ?? null)
        : null;
      const confWithAnchor = classifyPlacement({
        placement: placementWithAnchor,
        geometry: withAnchor.geometry,
        textBands: withAnchor.textBands,
        unanalyzedPages: withAnchor.unanalyzedPages,
        imageOnlyPages: withAnchor.imageOnlyPages,
        ocrOnlyPages: withAnchor.ocrOnlyPages,
        ...(choice
          ? {
              anchor: {
                kind: choice.kind,
                personalized: choice.personalized,
                signals: choice.signals,
                honored:
                  placementWithAnchor.status === 'ok' &&
                  placementWithAnchor.source === 'text-anchor',
                pageCoverage: coverage,
              },
            }
          : {}),
      });
      if (placementWithAnchor.status === 'ok') {
        placedWithAnchor++;
        if (confWithAnchor.level === 'alta') altaWithAnchor++;
        if (placementNoAnchor.status !== 'ok') closedByAnchor++;
        for (const r of confWithAnchor.reasons) reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
      } else {
        reasonCounts.set(
          `REVIEW:${placementWithAnchor.reason}`,
          (reasonCounts.get(`REVIEW:${placementWithAnchor.reason}`) ?? 0) + 1,
        );
      }

      // Salvaguarda: si YA se colocaba sin ancla, el rect con ancla debe ser
      // el MISMO rect, no solo "también ok".
      if (placementNoAnchor.status === 'ok') {
        alreadyOkChecked++;
        const same =
          placementWithAnchor.status === 'ok' &&
          placementWithAnchor.page === placementNoAnchor.page &&
          placementWithAnchor.x === placementNoAnchor.x &&
          placementWithAnchor.y === placementNoAnchor.y;
        if (same) rectUnchanged++;
        else {
          // Sin nombre de archivo a propósito: son documentos privados del
          // usuario, y el nombre puede llevar el de un cliente. Basta con la
          // magnitud del delta para diagnosticar una regresión.
          rectChanged.push(
            `sin-ancla p${placementNoAnchor.page} x=${placementNoAnchor.x.toFixed(1)} y=${placementNoAnchor.y.toFixed(1)} (${placementNoAnchor.source}) → ` +
              (placementWithAnchor.status === 'ok'
                ? `con-ancla p${placementWithAnchor.page} x=${placementWithAnchor.x.toFixed(1)} y=${placementWithAnchor.y.toFixed(1)} (${placementWithAnchor.source})`
                : `con-ancla REVIEW ${placementWithAnchor.reason}`),
          );
        }
      }
    } catch (err) {
      errors++;
      console.error(`  ! error en ${file}: ${(err as Error).message}`);
    }
    if ((i + 1) % 25 === 0) console.log(`  ... ${i + 1}/${unique.length}`);
  }

  console.log('\n=== SIN ancla (línea base, comportamiento FASE 2) ===');
  console.log(
    `  colocados: ${placedNoAnchor}/${unique.length}  |  sin colocar: ${unique.length - placedNoAnchor}`,
  );
  console.log(
    `  alta sobre colocados: ${placedNoAnchor > 0 ? ((100 * altaNoAnchor) / placedNoAnchor).toFixed(1) : 'n/a'}% (${altaNoAnchor}/${placedNoAnchor})`,
  );

  console.log('\n=== CON ancla genérica (anchorSpec vacío — solo "Firma"/"f)"/"firmado por") ===');
  console.log(
    `  colocados: ${placedWithAnchor}/${unique.length}  |  sin colocar: ${unique.length - placedWithAnchor}`,
  );
  console.log(
    `  alta sobre colocados: ${placedWithAnchor > 0 ? ((100 * altaWithAnchor) / placedWithAnchor).toFixed(1) : 'n/a'}% (${altaWithAnchor}/${placedWithAnchor})`,
  );
  console.log(
    `  documentos que el ancla CERRÓ (antes sin colocación, ahora colocados): ${closedByAnchor}`,
  );
  console.log(`  errores de lectura: ${errors}`);

  console.log('\n=== Desglose por motivo (con ancla) ===');
  for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`);
  }

  console.log('\n=== Salvaguarda: el rescate no debe mover un rect que ya funcionaba ===');
  console.log(
    `  documentos ya 'ok' sin ancla: ${alreadyOkChecked}  |  rect idéntico con ancla: ${rectUnchanged}  |  DISTINTO: ${rectChanged.length}`,
  );
  if (rectChanged.length > 0) {
    console.log('  ⚠️ regresiones detectadas:');
    for (const line of rectChanged.slice(0, 20)) console.log(`    ${line}`);
    if (rectChanged.length > 20) console.log(`    ... y ${rectChanged.length - 20} más`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
