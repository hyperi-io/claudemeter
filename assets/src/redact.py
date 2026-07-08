#!/usr/bin/env python3
# Project:   Claudemeter
# File:      assets/src/redact.py
# Purpose:   De-dox a status-bar tooltip screenshot for the README / marketplace
#            - swap the real account identity line ("**Name** (email)") for a
#            fake one, matching the tooltip's font, weight and colours so the
#            result looks native. Reusable for every screenshot refresh.
# Language:  Python 3 (Pillow)
#
# Ported from HyperI's internal screenshot-redaction tooling - this is how we
# redact identity/PII out of screenshots internally too.
#
# Usage:
#   uv run --with pillow assets/src/redact.py \
#       --in ~/Desktop/base.png --out ~/Desktop/final.png \
#       --name Zaphod --email beeblebrox@hyperi.io
#
# It auto-detects the identity line (the first text row carrying a blue email
# link - not the teal/coral logo above it), samples the tooltip background, ink
# and link colours from that row, measures the font size from the bold name,
# then repaints only that line. Nothing else in the image is touched, and no
# text is invented beyond the --name / --email you pass. Preview first with
# --dry-run (writes a zoomed crop next to --out, leaves --out unwritten).
#
# Safe by construction: no shell, no eval, no network, no subprocess. Inputs are
# validated, text is sanitised and length-capped, and every pixel write is
# clamped to the image bounds and to the tooltip background colour.
#
# License:   MIT
# Copyright: (c) 2026 HYPERI PTY LIMITED

import argparse
import os
import sys
from collections import Counter

from PIL import Image, ImageDraw, ImageFont

# macOS system font - the same face VS Code renders the tooltip with. Override
# with --font on other platforms.
DEFAULT_FONT = "/System/Library/Fonts/SFNS.ttf"
SF_CAP_RATIO = 0.714  # SF Pro cap-height / em, for size-from-cap-height
MAX_TEXT = 128  # sanity cap on --name / --email length


def die(msg):
    print(f"redact: {msg}", file=sys.stderr)
    sys.exit(1)


def sanitise(value, label):
    # Pillow draws the string literally (no markup, no shell), but keep it sane:
    # drop non-printable/control chars and cap the length so a pathological arg
    # can't smuggle newlines into the render or blow up the canvas.
    cleaned = "".join(ch for ch in value if ch.isprintable())
    if not cleaned:
        die(f"--{label} is empty after sanitising")
    if len(cleaned) > MAX_TEXT:
        die(f"--{label} too long (max {MAX_TEXT} chars)")
    return cleaned


def is_link_blue(rgb):
    # Clearly blue: blue channel dominates BOTH others by a margin. Excludes the
    # logo's teal (green >= blue) and coral (red dominates).
    r, g, b = rgb
    return b > g + 8 and b > r + 8 and b > 110


def is_grey(rgb):
    # Near-neutral: channels within a small spread of each other (the name /
    # regular tooltip text). Excludes the blue link and the coloured logo.
    r, g, b = rgb
    return abs(r - g) < 24 and abs(g - b) < 24 and abs(r - b) < 24


def find_identity_line(px, w, h):
    # Topmost text row-band containing a link-blue run = the "(email)" line.
    top = None
    for y in range(0, h):
        if any(is_link_blue(px[x, y]) for x in range(0, w, 2)):
            top = y
            break
    if top is None:
        die("could not find an identity line (no blue email link detected)")
    # Grow to the contiguous band of rows that still carry blue.
    bottom = top
    while bottom + 1 < h and any(
        is_link_blue(px[x, bottom + 1]) for x in range(0, w, 2)
    ):
        bottom += 1
    # Pad to cover ascenders/descenders around the blue run.
    return max(0, top - 18), min(h - 1, bottom + 14)


def sample_colours(px, w, y0, y1):
    # Background = most common colour across the band (the tooltip fills most of
    # the row beyond the short identity text).
    counts = Counter(px[x, y] for x in range(0, w) for y in range(y0, y1))
    bg = counts.most_common(1)[0][0]

    def far_from_bg(c):
        return abs(c[0] - bg[0]) + abs(c[1] - bg[1]) + abs(c[2] - bg[2]) > 24

    inks, links = [], []
    for y in range(y0, y1):
        for x in range(0, w):
            c = px[x, y]
            if not far_from_bg(c):
                continue
            if is_link_blue(c):
                links.append(c)
            elif abs(c[0] - c[1]) < 24 and abs(c[1] - c[2]) < 24:  # near-grey
                inks.append(c)
    if not inks:
        die("could not sample the ink (name) colour")
    if not links:
        die("could not sample the link (email) colour")
    ink = max(inks, key=lambda c: c[0] + c[1] + c[2])  # brightest grey
    link = max(links, key=lambda c: c[2] - (c[0] + c[1]) / 2)  # strongest blue
    return bg, ink, link


def measure_geometry(px, w, y0, y1, bg):
    # Gap (px) of empty background that separates the identity text from the
    # tooltip's left border. Walking left from the email, a gap this wide means
    # we have passed the name's left edge and are into the padding/border.
    PAD_GAP = 16

    def col_has_ink(x):
        return any(
            abs(px[x, y][0] - bg[0])
            + abs(px[x, y][1] - bg[1])
            + abs(px[x, y][2] - bg[2])
            > 24
            for y in range(y0, y1)
        )

    # First blue column = start of the "(email". The name + "(" sits just left.
    blue_x = None
    for x in range(0, w):
        if any(is_link_blue(px[x, y]) for y in range(y0, y1)):
            blue_x = x
            break
    if blue_x is None:
        die("could not find the email start")

    # Walk LEFT from the email through "(", the space and the name, stopping at
    # the wide padding gap before the tooltip border - so the border (a thin
    # edge far to the left) never contaminates the geometry.
    left = blue_x
    empty = 0
    for x in range(blue_x - 1, 0, -1):
        if col_has_ink(x):
            left = x
            empty = 0
        else:
            empty += 1
            if empty > PAD_GAP:
                break

    def grey_ink(x, y):
        c = px[x, y]
        return abs(c[0] - bg[0]) + abs(c[1] - bg[1]) + abs(
            c[2] - bg[2]
        ) > 24 and is_grey(c)

    # Name-only span: walk right from the left edge, stopping at the first word
    # space (a gap wider than inter-letter spacing) - the space before the "(".
    # Measuring caps from the BARE NAME avoids the parenthesis, whose over- and
    # under-hang otherwise inflates the cap-height (and so the font size, making
    # the redraw larger than the body text). Adapts per screenshot.
    NAME_GAP = 5
    name_end = left
    seen = False
    empty = 0
    for x in range(left, blue_x):
        if col_has_ink(x):
            name_end = x + 1
            seen = True
            empty = 0
        elif seen:
            empty += 1
            if empty >= NAME_GAP:
                break

    # Cap-top / baseline = rows with a real horizontal run (>= RUN px) of name
    # ink, so thin glyph tips don't skew the height.
    RUN = 3
    rows = [
        y
        for y in range(y0, y1)
        if sum(1 for x in range(left, name_end) if grey_ink(x, y)) >= RUN
    ]
    if not rows:
        die("could not measure the name glyph metrics")

    # Right edge of the OLD identity text: walk RIGHT from the name through
    # "(email)" and stop at the same wide padding gap - so we learn where the
    # old text ends WITHOUT running into the tooltip's right border (painting
    # over which leaves a visible flat patch). Adapts per screenshot.
    old_right = left
    empty = 0
    for x in range(left, w):
        if col_has_ink(x):
            old_right = x
            empty = 0
        else:
            empty += 1
            if empty > PAD_GAP:
                break

    return left, min(rows), max(rows), old_right  # left, cap_top, baseline, old_right


def load_face(font_path, size, bold):
    face = ImageFont.truetype(font_path, size)
    try:
        face.set_variation_by_name(b"Bold" if bold else b"Regular")
    except Exception:
        pass  # non-variable font: caller accepts the single face
    return face


def main():
    ap = argparse.ArgumentParser(
        description="De-dox a tooltip screenshot's account identity line."
    )
    ap.add_argument("--in", dest="src", required=True, help="input PNG")
    ap.add_argument("--out", dest="out", required=True, help="output PNG")
    ap.add_argument("--name", required=True, help="replacement display name")
    ap.add_argument("--email", required=True, help="replacement email")
    ap.add_argument(
        "--font", default=DEFAULT_FONT, help=f"TTF font (default {DEFAULT_FONT})"
    )
    ap.add_argument(
        "--box",
        type=int,
        nargs=4,
        metavar=("X0", "Y0", "X1", "Y1"),
        help="explicit overpaint rectangle, overriding auto-detection of its extent",
    )
    ap.add_argument(
        "--force", action="store_true", help="allow overwriting the input file"
    )
    ap.add_argument(
        "--dry-run", action="store_true", help="write a zoomed preview only, not --out"
    )
    args = ap.parse_args()

    src = os.path.abspath(os.path.expanduser(args.src))
    out = os.path.abspath(os.path.expanduser(args.out))
    font_path = os.path.abspath(os.path.expanduser(args.font))
    name = sanitise(args.name, "name")
    email = sanitise(args.email, "email")

    if not os.path.isfile(src):
        die(f"input not found: {src}")
    if not os.path.isfile(font_path):
        die(f"font not found: {font_path}")
    if os.path.abspath(out) == src and not args.force:
        die("refusing to overwrite the input; choose a different --out or pass --force")

    img = Image.open(src).convert("RGB")
    px = img.load()
    w, h = img.size

    y0, y1 = find_identity_line(px, w, h)
    bg, ink, link = sample_colours(px, w, y0, y1)
    left, cap_top, baseline, old_right = measure_geometry(px, w, y0, y1, bg)
    font_px = max(8, round((baseline - cap_top) / SF_CAP_RATIO))

    reg = load_face(font_path, font_px, bold=False)
    bold = load_face(font_path, font_px, bold=True)

    draw = ImageDraw.Draw(img)
    segments = [
        (name, bold, ink),
        (" (", reg, ink),
        (email, reg, link),
        (")", reg, ink),
    ]

    # Repaint width covers the OLD text (old_right, found without touching the
    # border) AND the NEW text (which may be longer or shorter), so either is
    # fully overwritten - and stops short of the tooltip's right border.
    new_w = sum(draw.textlength(t, font=f) for t, f, _ in segments)
    right = min(w - 1, max(old_right, left + int(new_w)) + 6)

    # An explicit --box wins over auto-detection when a layout defeats it.
    if args.box:
        bx0, by0, bx1, by1 = args.box
        rect = [max(0, bx0), max(0, by0), min(w - 1, bx1), min(h - 1, by1)]
    else:
        rect = [max(0, left - 3), max(0, cap_top - 5), right, min(h - 1, baseline + 13)]

    # Repaint the line band with the tooltip background, then draw the new text.
    draw.rectangle(rect, fill=bg)
    x = left
    for text, face, colour in segments:
        draw.text((x, baseline), text, font=face, fill=colour, anchor="ls")
        x += draw.textlength(text, font=face)

    print(f"line y[{y0}:{y1}] left={left} baseline={baseline} font={font_px}px")
    print(f"bg={bg} ink={ink} link={link}")

    if args.dry_run:
        preview = os.path.join(os.path.dirname(out), "redact-preview.png")
        crop = img.crop(
            (max(0, left - 5), max(0, cap_top - 10), right + 10, min(h, baseline + 20))
        )
        crop = crop.resize((crop.width * 3, crop.height * 3), Image.NEAREST)
        crop.save(preview)
        print(f"dry-run: preview -> {preview} (--out not written)")
    else:
        img.save(out)
        print(f"saved -> {out}")


if __name__ == "__main__":
    main()
