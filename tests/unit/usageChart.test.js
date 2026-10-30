// The tooltip chart: PNG size, pixel probes for the three lines, stroke, themes, the cache and bad data.

import { describe, it, expect, beforeEach } from 'vitest';
const { analyseUsage, MINUTE_MS, HOUR_MS } = require('../../src/burn');
const { analyseTurns } = require('../../src/tk/series');
const { PROFILES } = require('../../src/tk/profiles');
const { TIER_COLORS } = require('../../src/tk/colorMap');
const { renderUsageChart, resetChartCache, LAYOUT, SERIES_COLOURS } = require('../../src/usageChart');
const { decodePng } = require('../common/pngDecode');

const NOW = Date.UTC(2026, 9, 28, 0, 0, 0);
const profile = PROFILES['max-20x'];
const LIGHT = 1;
const DARK = 2;
const S = LAYOUT.scale;
const WIDTH = LAYOUT.width * S;
const HEIGHT = LAYOUT.height * S;
const PAD = 3 * S;
const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Plot percent to pixel, the same mapping the chart uses.
const px = (x) => Math.round(PAD + (x / 100) * (WIDTH - 2 * PAD));
const py = (y) => Math.round(HEIGHT - PAD - (y / 100) * (HEIGHT - 2 * PAD));

// Four samples 15 minutes apart at `pct`, the last one now, in a 5h window that began 2h ago (now at x 40%).
// The week resets in 3 days, so now sits at x 57% of it.
function history({ pct = [50, 50, 50, 50], reset = 180, weekPct = 40, week = 3 * 24 * 60 } = {}) {
    return pct.map((p, i) => ({
        ts: NOW - (pct.length - 1 - i) * 15 * MINUTE_MS,
        fiveHour: { pct: p, resetsAt: NOW + reset * MINUTE_MS },
        sevenDay: { pct: weekPct, resetsAt: NOW + week * MINUTE_MS },
        scoped: {},
    }));
}
const TURNS = [[35, 100e3], [30, 150e3], [25, 200e3], [20, 260e3], [15, 320e3], [10, 380e3], [5, 440e3], [0, 500e3]]
    .map(([a, t]) => ({ ts: NOW - a * MINUTE_MS, tokens: t }));
const decode = (uri) => decodePng(Buffer.from(uri.split(',')[1], 'base64'));

function input(samples, over = {}) {
    const flagged = over.flagged ?? false;
    return {
        analyses: {
            session: analyseUsage(samples, 'fiveHour', { now: NOW, flagged }),
            weekly: analyseUsage(samples, 'sevenDay', { now: NOW }),
            tokens: over.turns ? analyseTurns(over.turns, { profile, contextWindow: 1_000_000, now: NOW }) : null,
        },
        turns: over.turns ?? [],
        themeKind: DARK,
        now: NOW,
        ...over,
    };
}

// True when any pixel in the box around (x%, y%) is opaque in `hex`.
function colourNear(p, x, y, hex, radius = 3) {
    const want = hexRgb(hex).join();
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const [r, g, b, a] = p.at(px(x) + dx, py(y) + dy);
            if (a === 255 && [r, g, b].join() === want) return true;
        }
    }
    return false;
}

beforeEach(resetChartCache);

describe('renderUsageChart - the PNG', () => {
    it('is one 240 x 128 plot drawn at 2x, valid byte for byte', () => {
        const png = decode(renderUsageChart(input(history(), { turns: TURNS })));
        expect([LAYOUT.width, LAYOUT.height]).toEqual([240, 128]);
        expect([png.width, png.height]).toEqual([WIDTH, HEIGHT]);
        expect(png.types).toEqual(['IHDR', 'IDAT', 'IEND']);
    });

    it('stays small enough for a tooltip', () => {
        expect(renderUsageChart(input(history(), { turns: TURNS })).length).toBeLessThan(12000);
    });

    it.each([
        ['no gauge has a window', { analyses: { session: null, weekly: null, tokens: null } }],
        ['every window has expired', { analyses: { session: analyseUsage(history(), 'fiveHour', { now: NOW + 9 * HOUR_MS }), weekly: null, tokens: null } }],
    ])('returns null when %s', (_name, over) => {
        expect(renderUsageChart({ ...input([]), ...over })).toBeNull();
    });
});

describe('renderUsageChart - the lines', () => {
    const dark = SERIES_COLOURS.dark;

    it('draws the session line across its own window, flat at 50% up to now', () => {
        const p = decode(renderUsageChart(input(history())));
        expect(colourNear(p, 32, 50, dark.session)).toBe(true);
        expect(p.at(px(32), py(80))[3]).toBe(0);
    });

    it('draws the weekly line on its own window, rising from the week start to 40% at now', () => {
        const p = decode(renderUsageChart(input(history())));
        expect(colourNear(p, 28.5, 20, dark.weekly)).toBe(true);
    });

    it('draws Tk on the diagonal, as share of the auto-compact point on both axes', () => {
        const p = decode(renderUsageChart(input(history(), { turns: TURNS })));
        expect(colourNear(p, 30, 30, dark.tokens)).toBe(true);
    });

    it('draws a single Tk turn as a dot', () => {
        const p = decode(renderUsageChart(input(history(), { turns: TURNS.slice(-1) })));
        const at = (100 * 500e3) / 967e3;
        expect(colourNear(p, at, at, dark.tokens)).toBe(true);
    });

    it('takes the light series colours in a light theme', () => {
        const p = decode(renderUsageChart(input(history(), { themeKind: LIGHT })));
        expect(colourNear(p, 32, 50, SERIES_COLOURS.light.session)).toBe(true);
    });

    it('draws the 0% and 100% lines and a faint on-pace diagonal', () => {
        const p = decode(renderUsageChart(input(history())));
        expect(p.at(WIDTH - PAD - 2, py(0))[3]).toBeGreaterThan(0);
        expect(p.at(WIDTH - PAD - 2, py(100))[3]).toBeGreaterThan(0);
        let diagonal = 0;
        for (let x = 75; x <= 90; x++) {
            for (let d = -2; d <= 2; d++) if (p.at(px(x) + d, py(x))[3] > 0) diagonal++;
        }
        expect(diagonal).toBeGreaterThan(0);
        expect(p.at(px(80), py(20))[3]).toBe(0);
    });

    it('marks where a projection hits 100% before the reset with an opaque error-coloured diamond, and not otherwise', () => {
        const hasMarker = (p) => {
            const [r, g, b] = hexRgb(TIER_COLORS.error.hex);
            for (let i = 0; i < p.pixels.length; i += 4) {
                if (p.pixels[i] === r && p.pixels[i + 1] === g && p.pixels[i + 2] === b && p.pixels[i + 3] === 255) return true;
            }
            return false;
        };
        expect(hasMarker(decode(renderUsageChart(input(history({ pct: [49.5, 57, 64.5, 72] })))))).toBe(true);
        resetChartCache();
        expect(hasMarker(decode(renderUsageChart(input(history()))))).toBe(false);
        resetChartCache();
        expect(hasMarker(decode(renderUsageChart(input(history({ pct: [49.5, 50, 50.5, 51] })))))).toBe(false);
    });
});

describe('renderUsageChart - no text in the image', () => {
    it('draws only lines and guides, so the labels live in the tooltip text', () => {
        // A label used to sit above and right of the session line's end. Nothing is drawn there now.
        const p = decode(renderUsageChart(input(history())));
        let opaque = 0;
        for (let dy = -20; dy <= -6; dy++) {
            for (let dx = 8; dx <= 40; dx++) if (p.at(px(40) + dx, py(50) + dy)[3] === 255) opaque++;
        }
        expect(opaque).toBe(0);
    });

    it('draws every lived line as the same 2 css px stroke', () => {
        const p = decode(renderUsageChart(input(history())));
        // The flat session line at 50%: count opaque session-coloured rows at one x.
        const want = hexRgb(SERIES_COLOURS.dark.session).join();
        let rows = 0;
        for (let y = py(50) - 6; y <= py(50) + 6; y++) {
            const [r, g, b, al] = p.at(px(36), y);
            if (al === 255 && [r, g, b].join() === want) rows++;
        }
        expect(rows).toBe(2 * S);
    });
});

describe('renderUsageChart - the cache', () => {
    it('returns the same picture for the same samples even as the clock moves', () => {
        const first = renderUsageChart(input(history()));
        expect(renderUsageChart(input(history(), { now: NOW + 30 * 1000 }))).toBe(first);
    });

    it.each([
        ['a new sample', () => {
            const next = [...history(), { ...history()[3], ts: NOW + MINUTE_MS, fiveHour: { pct: 70, resetsAt: NOW + 180 * MINUTE_MS } }];
            return { analyses: { ...input(history()).analyses, session: analyseUsage(next, 'fiveHour', { now: NOW + MINUTE_MS }) } };
        }],
        ['a new Tk turn', () => ({ turns: TURNS, analyses: { ...input(history()).analyses, tokens: analyseTurns(TURNS, { profile, contextWindow: 1_000_000, now: NOW }) } })],
        ['a theme change', () => ({ themeKind: LIGHT })],
    ])('redraws on %s', (_name, change) => {
        const first = renderUsageChart(input(history()));
        expect(renderUsageChart(input(history(), change()))).not.toBe(first);
    });
});
