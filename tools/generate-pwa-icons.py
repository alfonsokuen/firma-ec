"""Generate PWA icons (192x192 and 512x512 PNG) from the firmar.ec brand concept.

Concept matches public/favicon.svg: rounded square in brand-900 (#0B1A3A) with
white "f" centered. The 512px variant uses 10% safe-area padding around the
glyph so it can be declared `purpose: "maskable"` in the manifest without
clipping on Android adaptive-icon shapes.

Usage:  python tools/generate-pwa-icons.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont  # type: ignore[import-not-found]

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "apps" / "pwa" / "public"

BRAND_BG = (11, 26, 58, 255)   # #0B1A3A — manifest theme_color
GLYPH = (255, 255, 255, 255)


def find_font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        # Geist isn't on Windows by default; fall back to system serifs/sans
        # that produce a confident bold "f" with similar weight to Geist Display 700.
        "C:/Windows/Fonts/seguibl.ttf",      # Segoe UI Black
        "C:/Windows/Fonts/segoeuib.ttf",     # Segoe UI Bold
        "C:/Windows/Fonts/arialbd.ttf",      # Arial Bold
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def make_icon(size: int, *, maskable: bool, out: Path) -> None:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Maskable icons need a 10% safe-area: the rounded rect should fill 100% of
    # the canvas so adaptive shapes never crop the glyph. Non-maskable can use a
    # smaller rounded rect (matches favicon.svg viewBox 64x64 with rx=12).
    if maskable:
        # Fill entire canvas with brand bg; round corners to ~22% for visual harmony
        radius = int(size * 0.22)
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=BRAND_BG)
        glyph_size = int(size * 0.55)  # ~55% so safe area is preserved
    else:
        # 6% margin matches favicon.svg proportions (rx=12 in 64-unit viewBox)
        margin = int(size * 0.0)
        radius = int(size * 0.18)
        draw.rounded_rectangle(
            (margin, margin, size - 1 - margin, size - 1 - margin),
            radius=radius,
            fill=BRAND_BG,
        )
        glyph_size = int(size * 0.62)

    font = find_font(glyph_size)
    text = "f"

    # Measure to center properly. Use textbbox for accurate metrics.
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (size - tw) // 2 - bbox[0]
    # Optical center: shift up slightly so the "f" sits visually centered (its
    # ascender bias makes mathematical center look low).
    ty = (size - th) // 2 - bbox[1] - int(size * 0.02)

    draw.text((tx, ty), text, font=font, fill=GLYPH)

    img.save(out, format="PNG", optimize=True)
    print(f"  wrote {out.relative_to(ROOT)} ({out.stat().st_size} bytes)")


def main() -> int:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    print("Generating PWA icons...")
    make_icon(192, maskable=False, out=PUBLIC / "icon-192.png")
    make_icon(512, maskable=True, out=PUBLIC / "icon-512.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
