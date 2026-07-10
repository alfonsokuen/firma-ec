import { describe, expect, it } from 'vitest';
import {
  computeGridPlacements,
  computeSmartPlacement,
  type ExistingSigRect,
  EDGE_MARGIN,
  GAP,
  placeAtBottomLastPage,
  placeBoxAtTap,
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

  // v0.20.x — regression: the grid used to anchor all 3 rows to the bottom
  // edge only (`y = EDGE_MARGIN + row*(h+GAP)`), so it never reached the
  // signature-line zone in the middle/upper page. Rows must now spread across
  // the full usable height, with the top row landing near the top edge.
  it('spreads rows across the full page height — top row reaches near the top edge', () => {
    const cells = computeGridPlacements({ pageDims: [A4], page: 0, existing: [] });
    expect(cells.length).toBe(6);
    const topRowY = Math.max(...cells.map((c) => c.y));
    // Old behaviour capped the top row around EDGE_MARGIN + 2*(h+GAP) ≈ 190pt
    // (bottom third of an A4 page). The new layout must clear that by a wide
    // margin and land close to `dim.h - EDGE_MARGIN - h`.
    const oldTopRowY = EDGE_MARGIN + 2 * (DEFAULT_H + GAP);
    expect(topRowY).toBeGreaterThan(oldTopRowY);
    expect(topRowY).toBeCloseTo(A4.h - EDGE_MARGIN - DEFAULT_H, 1);
  });

  // QA fix — a short page (e.g. h=200pt) used to be able to drive rowStep
  // negative ((usableH - h) / (GRID_ROWS - 1) with usableH < h), which could
  // push cells above/below the page bounds. rowStep must clamp to >= 0 and
  // every cell must stay within [EDGE_MARGIN, dim.h - EDGE_MARGIN].
  it('clamps rowStep to non-negative on a short page and keeps cells within bounds', () => {
    const shortPage: PageDim = { page: 0, w: 595, h: 200 };
    const cells = computeGridPlacements({ pageDims: [shortPage], page: 0, existing: [] });
    for (const c of cells) {
      expect(c.y).toBeGreaterThanOrEqual(EDGE_MARGIN - 0.01);
      expect(c.y + c.h).toBeLessThanOrEqual(shortPage.h - EDGE_MARGIN + 0.01);
    }
  });

  // QA fix — when the page is too short for even a single box with margins
  // (usableH < h), there is no valid grid: return no cells so the user falls
  // back to tap-anywhere / the auto-suggestion.
  it('returns no cells when the page is too short for a single box with margins', () => {
    const tooShort: PageDim = { page: 0, w: 595, h: DEFAULT_H + 2 * EDGE_MARGIN - 1 };
    const cells = computeGridPlacements({ pageDims: [tooShort], page: 0, existing: [] });
    expect(cells).toEqual([]);
  });
});

describe('placeBoxAtTap', () => {
  const cssWidth = A4.w; // scale = 1 for simplicity (1 CSS px = 1 pt)

  it('centers the box on the tap point (non-touch, scale=1)', () => {
    const tapCssX = 300;
    const tapCssY = 400;
    const res = placeBoxAtTap({
      tapCssX,
      tapCssY,
      cssWidth,
      pdfW: A4.w,
      pdfH: A4.h,
      isTouch: false,
      page: 1,
      w: DEFAULT_W,
      h: DEFAULT_H,
    });
    expect(res.page).toBe(1);
    // Center of the resulting box (PDF coords) should map back to the tap point.
    expect(res.x + res.w / 2).toBeCloseTo(tapCssX, 5);
    // tap Y (CSS, top-origin) -> PDF (bottom-origin): centerYPdf = pdfH - tapCssY
    expect(res.y + res.h / 2).toBeCloseTo(A4.h - tapCssY, 5);
  });

  it('applies the 24px touch offset upward when isTouch', () => {
    const tapCssX = 300;
    const tapCssY = 400;
    const touched = placeBoxAtTap({
      tapCssX,
      tapCssY,
      cssWidth,
      pdfW: A4.w,
      pdfH: A4.h,
      isTouch: true,
      page: 1,
      w: DEFAULT_W,
      h: DEFAULT_H,
    });
    const untouched = placeBoxAtTap({
      tapCssX,
      tapCssY,
      cssWidth,
      pdfW: A4.w,
      pdfH: A4.h,
      isTouch: false,
      page: 1,
      w: DEFAULT_W,
      h: DEFAULT_H,
    });
    // Touch shifts the *rendered* tap point up by 24 CSS px before converting
    // to pt (scale=1 here), which raises the box's PDF y (bottom-origin) by 24.
    expect(touched.y).toBeCloseTo(untouched.y + 24, 5);
  });

  it('clamps near a page edge to EDGE_MARGIN', () => {
    const res = placeBoxAtTap({
      tapCssX: 2, // far left, near the edge
      tapCssY: 2, // far top
      cssWidth,
      pdfW: A4.w,
      pdfH: A4.h,
      isTouch: false,
      page: 1,
      w: DEFAULT_W,
      h: DEFAULT_H,
    });
    expect(res.x).toBe(EDGE_MARGIN);
    // tap near the top (CSS y small) -> PDF y near the page top -> clamps to
    // the top edge margin.
    expect(res.y).toBeCloseTo(A4.h - EDGE_MARGIN - DEFAULT_H, 5);
  });

  it('is deterministic (same input -> same output)', () => {
    const opts = {
      tapCssX: 150,
      tapCssY: 200,
      cssWidth,
      pdfW: A4.w,
      pdfH: A4.h,
      isTouch: true,
      page: 1,
      w: DEFAULT_W,
      h: DEFAULT_H,
    };
    expect(placeBoxAtTap(opts)).toEqual(placeBoxAtTap(opts));
  });
});
