//  Project:      Claudemeter
//  File:         tests/e2e/glyphs.js
//  Purpose:      Screenshot and measure the bundled icon font glyphs in the status bar, per theme and tier
//  Language:     JavaScript (CommonJS)
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED
//
//  Description:
//      Usage: glyphs.js [--out <dir>]. Writes one PNG per theme and tier plus measurements.json.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const h = require('./harness');
const { OFFLINE_SETTINGS, seedHome } = require('./fixtures');

const { Undetermined } = h;

h.watchdog(20);

const THEMES = ['Default Light Modern', 'Default Dark Modern', 'Default High Contrast'];

const icon = (name) => `$(claudemeter-${name})`;
const STRIP = ['bar-2', 'bar-4', 'barh-5', 'barh-7', 'barh-8', 'blocked'].map(icon).join('');
const DOTS = ['dot', 'dot', 'dot-empty', 'dot-empty', 'dot-empty'].map(icon).join('');
const PANEL_BODY = { session: `${STRIP} ${DOTS} $(history) 2h 57m` };

const BASE = { contextWindow: 1_000_000, profileOverride: 'max-20x', colorMode: 'color', thresholdIcons: false, tokenUsed: 120_000 };
const TIERS = {
    normal: { ...BASE, sessionPercent: 40, weeklyPercent: 40 },
    warning: { ...BASE, sessionPercent: 85, weeklyPercent: 82 },
    error: { ...BASE, sessionPercent: 95, weeklyPercent: 93 },
};

const SCALE = 2;

function outputDir() {
    const at = process.argv.indexOf('--out');
    const dir = at === -1 ? path.join(h.SCRATCH, 'glyphs') : path.resolve(h.ROOT, process.argv[at + 1]);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// Runs in the page: the box, colour and font of the label text and of every icon in the Se and Wk items.
function measureItems() {
    const pick = (re) => [...document.querySelectorAll('.statusbar-item')]
        .find((el) => /claudemeter/i.test(el.id || '') && re.test((el.textContent || '').trim()));
    const box = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
    const read = (el) => {
        if (!el) return null;
        const label = el.querySelector('.statusbar-item-label') ?? el;
        const walker = document.createTreeWalker(label, 4 /* SHOW_TEXT */);
        const texts = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (!n.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(n);
            texts.push({ text: n.textContent.trim(), box: box(range.getBoundingClientRect()) });
        }
        const icons = [...label.querySelectorAll('.codicon')].map((span) => {
            const before = getComputedStyle(span, '::before');
            return {
                name: [...span.classList].find((c) => c.startsWith('codicon-') && c !== 'codicon-modifier') ?? '',
                box: box(span.getBoundingClientRect()),
                color: before.color,
                font: before.fontFamily,
                fontSize: before.fontSize,
            };
        });
        return { item: box(el.getBoundingClientRect()), color: getComputedStyle(label).color, texts, icons };
    };
    return { se: read(pick(/^Se\b/)), wk: read(pick(/^Wk\b/)) };
}

// Decodes the 8-bit, non-interlaced RGB or RGBA PNG a Playwright screenshot is.
function decodePng(buf) {
    let width = 0, height = 0, channels = 0;
    const idat = [];
    for (let i = 8; i < buf.length;) {
        const length = buf.readUInt32BE(i);
        const type = buf.toString('latin1', i + 4, i + 8);
        const body = buf.subarray(i + 8, i + 8 + length);
        if (type === 'IHDR') {
            width = body.readUInt32BE(0);
            height = body.readUInt32BE(4);
            channels = { 2: 3, 6: 4 }[body[9]];
        } else if (type === 'IDAT') {
            idat.push(body);
        }
        i += 12 + length;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const pixels = Buffer.alloc(height * stride);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        for (let x = 0; x < stride; x++) {
            const cur = raw[y * (stride + 1) + 1 + x];
            const a = x >= channels ? pixels[y * stride + x - channels] : 0;
            const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
            const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
            const paeth = () => {
                const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
                return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            };
            const predictor = [0, a, b, (a + b) >> 1, filter === 4 ? paeth() : 0][filter];
            pixels[y * stride + x] = (cur + predictor) & 255;
        }
    }
    return { width, height, channels, pixels };
}

// The ink bounds inside each box, in CSS px, where ink is any pixel far from the top-left background pixel.
function inkBounds(png, origin, boxes) {
    const { width, height, channels, pixels } = decodePng(png);
    const bg = [0, 1, 2].map((k) => pixels[k]);
    const inked = (x, y) => [0, 1, 2]
        .reduce((sum, k) => sum + Math.abs(pixels[(y * width + x) * channels + k] - bg[k]), 0) > 60;
    const css = (v, o) => +(v / SCALE + o).toFixed(2);
    return boxes.map((box) => {
        const x0 = Math.max(0, Math.round((box.x - origin.x) * SCALE));
        const x1 = Math.min(width, Math.round((box.x + box.width - origin.x) * SCALE));
        let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
        for (let y = 0; y < height; y++) {
            for (let x = x0; x < x1; x++) {
                if (!inked(x, y)) continue;
                top = Math.min(top, y); bottom = Math.max(bottom, y);
                left = Math.min(left, x); right = Math.max(right, x);
            }
        }
        if (top === Infinity) return null;
        return {
            top: css(top, origin.y), bottom: css(bottom + 1, origin.y),
            left: css(left, origin.x), right: css(right + 1, origin.x),
        };
    });
}

async function shoot(page, file) {
    const m = await page.evaluate(measureItems);
    if (!m.se || !m.wk) throw new Undetermined('the Se or Wk item is not drawn');
    const left = m.se.item.x - 4;
    const right = m.wk.item.x + m.wk.item.width + 4;
    const clip = { x: left, y: m.se.item.y, width: right - left, height: m.se.item.height };
    const png = await page.screenshot({ path: file, clip });
    const origin = { x: clip.x, y: clip.y };
    const ink = inkBounds(png, origin, m.se.icons.map((ic) => ic.box));
    const seText = m.se.texts.find((t) => t.text.startsWith('Se'));
    const wkText = m.wk.texts.find((t) => t.text.startsWith('Wk'));
    return {
        file,
        item: m.se.item,
        seColor: m.se.color,
        wkColor: m.wk.color,
        seText: seText && { box: seText.box, ink: inkBounds(png, origin, [seText.box])[0] },
        wkDots: wkText && { text: wkText.text, ink: inkBounds(png, origin, [wkText.box])[0] },
        icons: m.se.icons.map((ic, i) => ({ ...ic, ink: ink[i] })),
    };
}

async function main() {
    const out = outputDir();
    h.buildBundle();
    const results = [];
    for (const theme of THEMES) {
        const session = await h.launch({
            name: 'glyph-run',
            seed: seedHome,
            settings: { ...OFFLINE_SETTINGS, 'workbench.colorTheme': theme },
            args: [`--force-device-scale-factor=${SCALE}`],
        });
        try {
            await h.waitForItems(session.page, (all) => h.itemByText(all, /^Se /), 'the Se gauge');
            const colors = await h.readThemeColors(session.page);
            for (const [tier, state] of Object.entries(TIERS)) {
                await h.applyScenario(session, { ...state, panelBody: PANEL_BODY });
                await h.dismissHover(session.page);
                const slug = `${theme.replace(/\W+/g, '-').toLowerCase()}-${tier}.png`;
                const r = await shoot(session.page, path.join(out, slug));
                results.push({ theme, tier, colors, ...r });
                console.log(`shot: ${r.file}`);
            }
        } finally {
            await session.close();
        }
    }
    const file = path.join(out, 'measurements.json');
    fs.writeFileSync(file, JSON.stringify(results, null, 2), 'utf8');
    console.log(`measurements: ${file}`);
}

main().then(
    () => {
        console.log('RESULT: pass');
        process.exit(h.EXIT.pass);
    },
    (error) => {
        console.log(`RESULT: undetermined\n${error instanceof Undetermined ? error.message : error.stack}`);
        process.exit(h.EXIT.undetermined);
    },
);
