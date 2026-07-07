# Logo source

The claudemeter logo is generated from parametric vector code, not hand-edited.
Edit `generate.py` and re-run - never touch the output PNGs/SVGs by hand.
Ported from Derek's old svg generator py base.  

## Outputs (written to `assets/`)

| File | What | Consumed by |
|------|------|-------------|
| `logo.svg` / `logo.png` | Horizontal banner (star + wordmark) | `README.md` header |
| `icon.svg` / `icon.png` | Square hero (star + 3 monitoring icons + wordmark) | `package.json` `"icon"` (marketplace/VS Code) |

## Regenerate

```
uv run --with fonttools assets/src/generate.py
```

Needs `rsvg-convert` for the SVG->PNG step (`brew install librsvg`).

## Design notes

- **Mark**: a 12-arm coral asterisk. Arm thickness/hub are ratios of the arm
  radius, so the mark is identical at any size.
- **Wordmark**: Nunito 700, outlined to paths in the SVG (no font dependency
  at render time). "claude" coral, "meter" teal.
- **Monitoring icons** (square only): Lucide - `brain-circuit` (tokens),
  `calendar-days` (weekly), `clock` (session), in teal. Swap the names in
  `ICONS` to change them.
- **Colours**: coral `#D97757` (Claude brand) + muted teal `#2FA198`. Both are
  mid-luminance so the logo reads on light AND dark backgrounds - do not use a
  dark neutral (it vanishes on dark).

## Bundled dependencies

- `fonts/Nunito.ttf` - SIL Open Font License (`fonts/OFL.txt`).
- `icons/*.svg` - Lucide, ISC License (`icons/LICENSE`).

Both are permissive and redistributable; bundled so the logo is reproducible
without network access.
