#!/usr/bin/env python3
# Project:   Claudemeter
# File:      assets/src/generate.py
# Purpose:   Single source of truth for the claudemeter logo. Generates the
#            master SVGs and the consumed PNGs from parametric vector code.
#
#   Outputs (into assets/):
#     logo.svg  / logo.png   - horizontal banner (star + wordmark), README
#     icon.svg  / icon.png   - square marketplace hero (star + 3 monitoring
#                              icons + wordmark), package.json "icon"
#
#   The mark is a 12-arm coral asterisk; the wordmark is Nunito 700 outlined
#   to paths (self-contained, no font dependency in the SVG); the three
#   monitoring icons are Lucide (tokens=brain-circuit, weekly=calendar-days,
#   session=clock) in teal. Coral + teal are both mid-luminance so the logo
#   reads on light AND dark backgrounds.
#
#   Run:  uv run --with fonttools assets/src/generate.py
#   Deps: fonttools (outlining) + rsvg-convert (SVG->PNG, `brew install librsvg`)
#   Bundled: fonts/Nunito.ttf (OFL), icons/*.svg (Lucide, ISC) - see their
#            licenses alongside.
#
# License:   MIT
# Copyright: (c) 2026 HYPERI PTY LIMITED

import math
import os
import re
import subprocess
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.varLib.instancer import instantiateVariableFont

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.dirname(HERE)
FONT_PATH = os.path.join(HERE, "fonts", "Nunito.ttf")
ICON_DIR = os.path.join(HERE, "icons")

CORAL = "#D97757"  # Claude brand coral - warm, mid-luminance
TEAL = "#2FA198"  # muted teal - cool complement, mid-luminance
WORD = "claudemeter"
SPLIT = 6  # "claude"=coral, "meter"=teal

# Star arm ratios (relative to arm radius) - locked from the approved design.
RAYS, RW_R, HUB_R, RIN_R = 12, 8.5 / 58, 13.0 / 58, 2.0 / 58
ICONS = ["brain-circuit", "calendar-days", "clock"]  # tokens, weekly, session
LUCIDE_SW = 2.1  # stroke width in Lucide's 24-unit grid

# --- font -------------------------------------------------------------------
_font = TTFont(FONT_PATH)
instantiateVariableFont(_font, {"wght": 700}, inplace=True)
_gs = _font.getGlyphSet()
_cmap = _font.getBestCmap()
_upm = _font["head"].unitsPerEm
_cap = getattr(_font["OS/2"], "sCapHeight", int(0.72 * _upm))


def _glyph(ch):
    g = _gs[_cmap[ord(ch)]]
    pen = SVGPathPen(_gs)
    g.draw(pen)
    return pen.getCommands(), g.width


def wordmark(x0, baseline, fpx):
    """Outlined wordmark. Returns (svg, advance_width)."""
    sc = fpx / _upm
    out, x = [], x0
    for i, ch in enumerate(WORD):
        d, adv = _glyph(ch)
        if d.strip():
            col = CORAL if i < SPLIT else TEAL
            out.append(
                f'<g transform="translate({x:.2f},{baseline:.2f}) '
                f'scale({sc:.5f},{-sc:.5f})"><path d="{d}" fill="{col}"/></g>'
            )
        x += adv * sc
    return "".join(out), x - x0


def wordmark_width(fpx):
    sc = fpx / _upm
    return sum(_glyph(c)[1] for c in WORD) * sc


def sunburst(cx, cy, r_out):
    rw, hub, rin = r_out * RW_R, r_out * HUB_R, r_out * RIN_R
    lines = "".join(
        f'<line x1="{cx + rin * math.cos(t):.2f}" y1="{cy + rin * math.sin(t):.2f}" '
        f'x2="{cx + r_out * math.cos(t):.2f}" y2="{cy + r_out * math.sin(t):.2f}"/>'
        for t in [(2 * math.pi * i / RAYS - math.pi / 2) for i in range(RAYS)]
    )
    return (
        f'<g stroke="{CORAL}" stroke-width="{rw:.2f}" stroke-linecap="round">{lines}</g>'
        f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{hub:.2f}" fill="{CORAL}"/>'
    )


def _lucide_inner(name):
    s = open(os.path.join(ICON_DIR, name + ".svg")).read()
    return re.search(r"<svg[^>]*>(.*)</svg>", s, re.S).group(1).strip()


def lucide(name, cx, cy, size):
    sc = size / 24.0
    return (
        f'<g transform="translate({cx - size / 2:.2f},{cy - size / 2:.2f}) scale({sc:.4f})">'
        f'<g fill="none" stroke="{TEAL}" stroke-width="{LUCIDE_SW}" '
        f'stroke-linecap="round" stroke-linejoin="round">{_lucide_inner(name)}</g></g>'
    )


def _svg(w, h, body):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.1f} {h:.1f}" '
        f'width="{w:.1f}" height="{h:.1f}">{body}</svg>\n'
    )


def build_banner():
    """Horizontal: star left, wordmark right."""
    fpx, r_out, gap, pad = 100.0, 58.0, 34.0, 16.0
    ww = wordmark_width(fpx)
    content_h = max(r_out * 2, fpx)
    mark_cx, mark_cy = pad + r_out, pad + content_h / 2
    word_x0 = pad + r_out * 2 + gap
    baseline = pad + content_h / 2 + fpx * 0.36
    w, h = word_x0 + ww + pad, content_h + 2 * pad
    word, _ = wordmark(word_x0, baseline, fpx)
    return _svg(w, h, sunburst(mark_cx, mark_cy, r_out) + word)


def build_square():
    """Square: star top, 3 icons row (centred in the gap), wordmark bottom."""
    S, pad = 512.0, 46.0
    star_r = 108.0
    star_cy = pad + star_r
    star_bottom = star_cy + star_r
    fpx = 74.0
    baseline = S - pad - 6
    word_top = baseline - _cap * (fpx / _upm)
    icon_size, gapx = 74.0, 108.0
    icon_cy = (star_bottom + word_top) / 2  # equal whitespace above/below
    ww = wordmark_width(fpx)
    word, _ = wordmark(S / 2 - ww / 2, baseline, fpx)
    icons = "".join(
        lucide(n, S / 2 + (j - 1) * gapx, icon_cy, icon_size)
        for j, n in enumerate(ICONS)
    )
    return _svg(S, S, sunburst(S / 2, star_cy, star_r) + icons + word)


def render_png(svg_path, png_path, args):
    subprocess.run(["rsvg-convert", *args, svg_path, "-o", png_path], check=True)


def main():
    banner = os.path.join(ASSETS, "logo.svg")
    square = os.path.join(ASSETS, "icon.svg")
    open(banner, "w").write(build_banner())
    open(square, "w").write(build_square())
    # PNGs at the sizes the README / marketplace consume (2x for crispness).
    render_png(banner, os.path.join(ASSETS, "logo.png"), ["-w", "1000"])
    render_png(square, os.path.join(ASSETS, "icon.png"), ["-w", "256", "-h", "256"])
    # Slim banner for the status-bar tooltip header. VS Code markdown renders a
    # PNG data URI at its native pixel width (no CSS width control), so this
    # width IS the on-screen width - sized to match the tooltip's "Resets ..."
    # text line. Bump the -w if you want it wider.
    render_png(banner, os.path.join(ASSETS, "logo-tooltip.png"), ["-w", "158"])
    print("generated: assets/logo.svg logo.png  logo-tooltip.png  icon.svg icon.png")


if __name__ == "__main__":
    main()
