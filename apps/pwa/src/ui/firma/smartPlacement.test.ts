import { describe, expect, it } from 'vitest';
import {
  computeGridPlacements,
  computeSmartPlacement,
  type ExistingSigRect,
  EDGE_MARGIN,
  GAP,
  placeAtBottomLastPage,
  type PageDim,
} from './smartPlacement.ts';

const A4: PageDim = { page: 0, w: 595, h: 842 };
const DEFAULT_W = 240;
const DEFAULT_H = 72;

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function call(existing: ExistingSigRect[], pageDims: PageDim[] = [A4]) {
  return computeSmartPlacement({
    existing,
    pageDims,
    defaultW: DEFAULT_W,
    defaultH: DEFAULT_H,
  });
}

describe('computeSmartPlacement', () => {
  it('returns null when there are no existing signatures (keep default)', () => {
    expect(call([])).toBeNull();
  });

  it('returns null when existing signatures are all invisible (degenerate rect)', () => {
    expect(call([{ page: 0, x: 0, y: 0, w: 0, h: 0 }])).toBeNull();
    expect(call([{ page: 0, x: 100, y: 100, w: 0.5, h: 0.5 }])).toBeNull();
  });

  it('returns null when NaN/garbage rects are present and nothing visible remains', () => {
    expect(call([{ page: 0, x: Number.NaN, y: 10, w: 200, h: 60 }])).toBeNull();
  });

  it('places the new box beside (not over) a single visible existing signature', () => {
    const existing: ExistingSigRect[] = [{ page: 0, x: 40, y: 60, w: 200, h: 70 }];
    const res = call(existing);
    expect(res).not.toBeNull();
    expect(res!.page).toBe(1); // 1-based
    // must not overlap the existing signature
    expect(overlaps(res!, existing[0]!)).toBe(false);
    // should sit to the right on the same band (x greater than the existing right edge)
    expect(res!.x).toBeGreaterThanOrEqual(existing[0]!.x + existing[0]!.w);
    // inside page bounds
    expect(res!.x + res!.w).toBeLessThanOrEqual(A4.w);
    expect(res!.y + res!.h).toBeLessThanOrEqual(A4.h);
  });

  it('stacks a row above when the bottom band is full', () => {
    // Two wide signatures fill the bottom row → no horizontal room left.
    const existing: ExistingSigRect[] = [
      { page: 0, x: 18, y: 60, w: 270, h: 70 },
      { page: 0, x: 305, y: 60, w: 270, h: 70 },
    ];
    const res = call(existing);
    expect(res).not.toBeNull();
    // no overlap with either existing
    for (const e of existing) expect(overlaps(res!, e)).toBe(false);
    // placed in a higher band (y above the existing baseline)
    expect(res!.y).toBeGreaterThan(60);
  });

  it('never overlaps any existing signature on the target page (fuzz-ish)', () => {
    const existing: ExistingSigRect[] = [
      { page: 0, x: 30, y: 50, w: 150, h: 60 },
      { page: 0, x: 200, y: 50, w: 150, h: 60 },
      { page: 0, x: 30, y: 130, w: 150, h: 60 },
    ];
    const res = call(existing);
    expect(res).not.toBeNull();
    for (const e of existing) expect(overlaps(res!, e)).toBe(false);
  });

  it('targets the page of the LAST existing signature (co-signers cluster)', () => {
    const pages: PageDim[] = [
      { page: 0, w: 595, h: 842 },
      { page: 1, w: 595, h: 842 },
      { page: 2, w: 595, h: 842 },
    ];
    const existing: ExistingSigRect[] = [
      { page: 0, x: 40, y: 60, w: 200, h: 70 },
      { page: 2, x: 40, y: 60, w: 200, h: 70 },
    ];
    const res = computeSmartPlacement({
      existing,
      pageDims: pages,
      defaultW: DEFAULT_W,
      defaultH: DEFAULT_H,
    });
    expect(res).not.toBeNull();
    expect(res!.page).toBe(3); // last signature is on page index 2 → 1-based 3
  });

  it('returns null when the target page has no known dimensions', () => {
    // signature on page 2 but pageDims only knows page 0
    const existing: ExistingSigRect[] = [{ page: 2, x: 40, y: 60, w: 200, h: 70 }];
    expect(call(existing, [A4])).toBeNull();
  });

  it('clamps the box size to the page proportions on tiny pages', () => {
    const tiny: PageDim = { page: 0, w: 200, h: 150 };
    const existing: ExistingSigRect[] = [{ page: 0, x: 10, y: 10, w: 60, h: 30 }];
    const res = call(existing, [tiny]);
    expect(res).not.toBeNull();
    expect(res!.w).toBeLessThanOrEqual(tiny.w * 0.6 + 0.001);
    expect(res!.h).toBeLessThanOrEqual(tiny.h * 0.2 + 0.001);
    // still within bounds
    expect(res!.x).toBeGreaterThanOrEqual(0);
    expect(res!.y).toBeGreaterThanOrEqual(0);
    expect(res!.x + res!.w).toBeLessThanOrEqual(tiny.w);
    expect(res!.y + res!.h).toBeLessThanOrEqual(tiny.h);
  });
});

describe('placeAtBottomLastPage', () => {
  it('places the box at the bottom-center of an empty page', () => {
    const res = placeAtBottomLastPage({ pageDims: [A4], lastPage: 0, existing: [] });
    expect(res.page).toBe(1); // 1-based
    expect(res.x).toBeCloseTo((A4.w - DEFAULT_W) / 2, 5);
    expect(res.y).toBeCloseTo(EDGE_MARGIN, 5);
    expect(res.w).toBe(DEFAULT_W);
    expect(res.h).toBe(DEFAULT_H);
  });

  it('is deterministic (same input -> same output)', () => {
    const existing: ExistingSigRect[] = [{ page: 0, x: 40, y: 60, w: 200, h: 70 }];
    const a = placeAtBottomLastPage({ pageDims: [A4], lastPage: 0, existing });
    const b = placeAtBottomLastPage({ pageDims: [A4], lastPage: 0, existing });
    expect(a).toEqual(b);
  });

  it('climbs above an existing signature occupying the bottom band', () => {
    const existing: ExistingSigRect[] = [
      { page: 0, x: (A4.w - DEFAULT_W) / 2, y: EDGE_MARGIN, w: DEFAULT_W, h: DEFAULT_H },
    ];
    const res = placeAtBottomLastPage({ pageDims: [A4], lastPage: 0, existing });
    expect(res.y).toBeGreaterThan(EDGE_MARGIN);
    expect(overlaps(res, existing[0]!)).toBe(false);
    expect(res.y + res.h).toBeLessThanOrEqual(A4.h);
  });

  it('falls back gracefully when the page is saturated (does not throw, returns a valid box)', () => {
    // Fill the whole vertical band with signatures wide enough to block the centered x too.
    const existing: ExistingSigRect[] = [];
    for (let y = EDGE_MARGIN; y + DEFAULT_H <= A4.h - EDGE_MARGIN; y += DEFAULT_H + GAP) {
      existing.push({ page: 0, x: EDGE_MARGIN, y, w: A4.w - EDGE_MARGIN * 2, h: DEFAULT_H });
    }
    const res = placeAtBottomLastPage({ pageDims: [A4], lastPage: 0, existing });
    expect(res.page).toBe(1);
    expect(Number.isFinite(res.x)).toBe(true);
    expect(Number.isFinite(res.y)).toBe(true);
    expect(res.w).toBeGreaterThan(0);
    expect(res.h).toBeGreaterThan(0);
  });

  it('is deterministic on the saturated-page fallback too', () => {
    const existing: ExistingSigRect[] = [];
    for (let y = EDGE_MARGIN; y + DEFAULT_H <= A4.h - EDGE_MARGIN; y += DEFAULT_H + GAP) {
      existing.push({ page: 0, x: EDGE_MARGIN, y, w: A4.w - EDGE_MARGIN * 2, h: DEFAULT_H });
    }
    const a = placeAtBottomLastPage({ pageDims: [A4], lastPage: 0, existing });
    const b = placeAtBottomLastPage({ pageDims: [A4], lastPage: 0, existing });
    expect(a).toEqual(b);
  });
});

describe('computeGridPlacements', () => {
  it('returns 6 candidate cells for an empty page, all within page bounds', () => {
    const cells = computeGridPlacements({ pageDims: [A4], page: 0, existing: [] });
    expect(cells).toHaveLength(6);
    for (const c of cells) {
      expect(c.page).toBe(1);
      expect(c.x).toBeGreaterThanOrEqual(EDGE_MARGIN);
      expect(c.y).toBeGreaterThanOrEqual(EDGE_MARGIN);
      expect(c.x + c.w).toBeLessThanOrEqual(A4.w - EDGE_MARGIN + 0.01);
      expect(c.y + c.h).toBeLessThanOrEqual(A4.h - EDGE_MARGIN + 0.01);
    }
  });

  it('filters out cells that collide with existing signatures', () => {
    // Occupy exactly the bottom-left cell.
    const existing: ExistingSigRect[] = [
      { page: 0, x: EDGE_MARGIN, y: EDGE_MARGIN, w: DEFAULT_W, h: DEFAULT_H },
    ];
    const cells = computeGridPlacements({ pageDims: [A4], page: 0, existing });
    expect(cells.length).toBeLessThan(6);
    for (const c of cells) expect(overlaps(c, existing[0]!)).toBe(false);
  });

  it('returns no overlapping cells among the candidates themselves', () => {
    const cells = computeGridPlacements({ pageDims: [A4], page: 0, existing: [] });
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        expect(overlaps(cells[i]!, cells[j]!)).toBe(false);
      }
    }
  });

  it('returns an empty array when the page has no known dimensions', () => {
    const cells = computeGridPlacements({ pageDims: [A4], page: 5, existing: [] });
    expect(cells).toEqual([]);
  });
});
