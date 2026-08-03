/**
 * Tests for pageGeometry.ts — lectura de /MediaBox, /CropBox y /Rotate,
 * incluyendo herencia del árbol /Pages (spec §4 criterio 4).
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFPageLeaf } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { normalizeRotate, readPageGeometry } from '../src/pageGeometry.js';

describe('normalizeRotate', () => {
  it('deja pasar 0/90/180/270 tal cual', () => {
    expect(normalizeRotate(0)).toBe(0);
    expect(normalizeRotate(90)).toBe(90);
    expect(normalizeRotate(180)).toBe(180);
    expect(normalizeRotate(270)).toBe(270);
  });

  it('colapsa negativos al rango [0,360)', () => {
    expect(normalizeRotate(-90)).toBe(270);
    expect(normalizeRotate(-180)).toBe(180);
    expect(normalizeRotate(-450)).toBe(270); // -450 mod 360 = -90 -> 270
  });

  it('colapsa múltiplos de 360', () => {
    expect(normalizeRotate(450)).toBe(90);
    expect(normalizeRotate(720)).toBe(0);
    expect(normalizeRotate(810)).toBe(90);
  });

  it('trata un valor no múltiplo de 90 como 0 en vez de reventar', () => {
    expect(normalizeRotate(45)).toBe(0);
    expect(normalizeRotate(Number.NaN)).toBe(0);
    expect(normalizeRotate(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('readPageGeometry', () => {
  it('página normal sin CropBox ni Rotate: visArea = MediaBox, rotate = 0', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const [geo] = readPageGeometry(doc);
    expect(geo).toEqual({
      page: 0,
      mediaW: 595,
      mediaH: 842,
      mediaX: 0,
      mediaY: 0,
      visX: 0,
      visY: 0,
      visW: 595,
      visH: 842,
      rotate: 0,
    });
  });

  it('normaliza /Rotate negativo/no-múltiplo definido directamente en la página', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    page.node.set(PDFName.of('Rotate'), doc.context.obj(-90));
    const [geo] = readPageGeometry(doc);
    expect(geo!.rotate).toBe(270);
  });

  it('CropBox más chico que MediaBox: visArea = intersección, en coords absolutas', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    page.node.set(PDFName.of('CropBox'), doc.context.obj([40, 300, 555, 800]));
    const [geo] = readPageGeometry(doc);
    expect(geo!.mediaW).toBe(595);
    expect(geo!.mediaH).toBe(842);
    expect(geo!.visX).toBe(40);
    expect(geo!.visY).toBe(300);
    expect(geo!.visW).toBe(515); // 555-40
    expect(geo!.visH).toBe(500); // 800-300
  });

  it('CropBox invertido (x1>x2) cae a MediaBox en vez de reventar', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    page.node.set(PDFName.of('CropBox'), doc.context.obj([555, 800, 40, 300]));
    const [geo] = readPageGeometry(doc);
    expect(geo!.visX).toBe(0);
    expect(geo!.visY).toBe(0);
    expect(geo!.visW).toBe(595);
    expect(geo!.visH).toBe(842);
  });

  it('CropBox disjunto de MediaBox cae a MediaBox en vez de reventar', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    // CropBox totalmente fuera del MediaBox (x negativo, sin solape).
    page.node.set(PDFName.of('CropBox'), doc.context.obj([-500, -500, -100, -100]));
    const [geo] = readPageGeometry(doc);
    expect(geo!.visX).toBe(0);
    expect(geo!.visW).toBe(595);
  });

  it('hereda /MediaBox, /CropBox y /Rotate definidos SOLO en el nodo /Pages padre', async () => {
    const doc = await PDFDocument.create();
    const pagesNode = doc.catalog.lookup(PDFName.of('Pages'), PDFDict);
    pagesNode.set(PDFName.of('MediaBox'), doc.context.obj([0, 0, 300, 400]));
    pagesNode.set(PDFName.of('CropBox'), doc.context.obj([10, 10, 290, 390]));
    pagesNode.set(PDFName.of('Rotate'), doc.context.obj(90));

    // Hoja SIN su propia /MediaBox ni /CropBox ni /Rotate — solo Parent.
    const leaf = PDFPageLeaf.withContextAndParent(doc.context, pagesNode);
    leaf.dict.delete(PDFName.of('MediaBox'));
    const pageRef = doc.context.register(leaf);
    const kids = pagesNode.lookup(PDFName.of('Kids'), PDFArray);
    kids.push(pageRef);
    pagesNode.set(PDFName.of('Count'), doc.context.obj(kids.size()));

    const [geo] = readPageGeometry(doc);
    expect(geo).toBeDefined();
    expect(geo!.mediaW).toBe(300);
    expect(geo!.mediaH).toBe(400);
    expect(geo!.visX).toBe(10);
    expect(geo!.visY).toBe(10);
    expect(geo!.visW).toBe(280);
    expect(geo!.visH).toBe(380);
    expect(geo!.rotate).toBe(90);
  });

  it('MediaBox con origen ≠ (0,0) se preserva (no se asume 0,0)', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    page.node.set(PDFName.of('MediaBox'), doc.context.obj([50, 50, 645, 892]));
    const [geo] = readPageGeometry(doc);
    expect(geo!.mediaX).toBe(50);
    expect(geo!.mediaY).toBe(50);
    expect(geo!.mediaW).toBe(595);
    expect(geo!.mediaH).toBe(842);
  });

  it('múltiples páginas: cada una con su propio índice 0-based', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const p2 = doc.addPage([842, 595]);
    p2.node.set(PDFName.of('Rotate'), doc.context.obj(90));
    const geo = readPageGeometry(doc);
    expect(geo).toHaveLength(2);
    expect(geo[0]!.page).toBe(0);
    expect(geo[1]!.page).toBe(1);
    expect(geo[1]!.rotate).toBe(90);
  });
});
