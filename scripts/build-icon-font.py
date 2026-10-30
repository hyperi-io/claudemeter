#  Project:      Claudemeter
#  File:         scripts/build-icon-font.py
#  Purpose:      Generate the status bar icon font from code
#  Language:     Python
#
#  License:      MIT
#  Copyright:    (c) 2026 HYPERI PTY LIMITED
#
#  Description:
#      uv run --no-project --with fonttools==4.67.0 scripts/build-icon-font.py

"""Draw the bar, blocked and dot glyphs on the codicon grid and save them as WOFF."""

import math
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

# One codicon grid unit in font units, on a 16-unit em.
UNIT = 64
EM = 16 * UNIT
FIRST_CODEPOINT = 0xE000

# Every glyph fills the dot's 9 x 9 box on the dot's 11-unit advance.
ADVANCE = 11
DOT_RADIUS = 4.5
BAR_LEFT = ADVANCE / 2 - DOT_RADIUS
BAR_RIGHT = ADVANCE / 2 + DOT_RADIUS
# The status bar centres the 16-unit box on the text, which puts the text baseline 3.5 units up.
BAR_FLOOR = 3.5
BAR_TOP = BAR_FLOOR + 2 * DOT_RADIUS
DOT_CENTRE = BAR_FLOOR + DOT_RADIUS
OUTLINE = 1.25

# 2026-01-01T00:00:00Z in seconds since 1904, so a rebuild is byte-identical.
FIXED_TIMESTAMP = 3850070400

OUT = (
    Path(__file__).resolve().parent.parent
    / "assets"
    / "icons"
    / "claudemeter-icons.woff"
)


def _scale(point):
    return (round(point[0] * UNIT), round(point[1] * UNIT))


def _contour(pen, points):
    pen.moveTo(_scale(points[0]))
    for point in points[1:]:
        pen.lineTo(_scale(point))
    pen.closePath()


def rect(pen, x0, y0, x1, y1, ink=True):
    """Clockwise draws ink and counter-clockwise cuts a hole."""
    points = [(x0, y0), (x0, y1), (x1, y1), (x1, y0)]
    _contour(pen, points if ink else points[::-1])


def circle(pen, cx, cy, r, ink=True, steps=32):
    sign = -1 if ink else 1
    angles = [sign * 2 * math.pi * i / steps for i in range(steps)]
    _contour(pen, [(cx + r * math.cos(a), cy + r * math.sin(a)) for a in angles])


def bar_top(eighths):
    return BAR_FLOOR + (BAR_TOP - BAR_FLOOR) * eighths / 8


def filled_bar(pen, eighths):
    rect(pen, BAR_LEFT, BAR_FLOOR, BAR_RIGHT, bar_top(eighths))


def hollow_bar(pen, eighths):
    top = bar_top(eighths)
    rect(pen, BAR_LEFT, BAR_FLOOR, BAR_RIGHT, top)
    # A bar too short for a hole stays solid.
    if top - BAR_FLOOR > 2 * OUTLINE:
        rect(
            pen,
            BAR_LEFT + OUTLINE,
            BAR_FLOOR + OUTLINE,
            BAR_RIGHT - OUTLINE,
            top - OUTLINE,
            ink=False,
        )


def blocked(pen):
    cells = math.ceil(BAR_RIGHT - BAR_LEFT)
    for row in range(cells):
        y0 = BAR_FLOOR + row
        y1 = min(y0 + 1, BAR_TOP)
        for col in range(cells):
            if (row + col) % 2 == 0:
                x0 = BAR_LEFT + col
                rect(pen, x0, y0, min(x0 + 1, BAR_RIGHT), y1)


def dot(pen):
    circle(pen, ADVANCE / 2, DOT_CENTRE, DOT_RADIUS)


def dot_empty(pen):
    circle(pen, ADVANCE / 2, DOT_CENTRE, DOT_RADIUS)
    circle(pen, ADVANCE / 2, DOT_CENTRE, DOT_RADIUS - OUTLINE, ink=False)


def glyph_table():
    table = [(f"bar-{n}", lambda pen, n=n: filled_bar(pen, n)) for n in range(1, 9)]
    table += [(f"barh-{n}", lambda pen, n=n: hollow_bar(pen, n)) for n in range(1, 9)]
    table += [("blocked", blocked), ("dot", dot), ("dot-empty", dot_empty)]
    return table


def build():
    table = glyph_table()
    names = [".notdef"] + [name for name, _ in table]
    glyphs = {".notdef": TTGlyphPen(None).glyph()}
    cmap = {}
    for index, (name, draw) in enumerate(table):
        pen = TTGlyphPen(None)
        draw(pen)
        glyphs[name] = pen.glyph()
        cmap[FIRST_CODEPOINT + index] = name

    # Glyph bottom on the baseline and the 16 x 16 square above it, as codicons do.
    fb = FontBuilder(EM, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    # The left side bearing must equal xMin, or the renderer moves the ink to x = 0.
    glyf = fb.font["glyf"]
    fb.setupHorizontalMetrics(
        {name: (ADVANCE * UNIT, getattr(glyf[name], "xMin", 0)) for name in names}
    )
    fb.setupHorizontalHeader(ascent=EM, descent=0)
    fb.setupNameTable({"familyName": "claudemeter-icons", "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=EM, sTypoDescender=0, usWinAscent=EM, usWinDescent=0)
    fb.setupPost()
    fb.font.flavor = "woff"
    fb.font["head"].created = FIXED_TIMESTAMP
    fb.font["head"].modified = FIXED_TIMESTAMP
    fb.font.recalcTimestamp = False
    OUT.parent.mkdir(parents=True, exist_ok=True)
    fb.save(str(OUT))
    for code, name in cmap.items():
        print(f"claudemeter-{name} \\{code:X}")


if __name__ == "__main__":
    build()
