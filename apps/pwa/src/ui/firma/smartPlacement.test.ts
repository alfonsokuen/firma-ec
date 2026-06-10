import { describe, expect, it } from 'vitest';
import { type ExistingSigRect, type PageDim, computeSmartPlacement } from './smartPlacement.ts';

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
