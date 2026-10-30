// Project:   Claudemeter
// File:      usageChart.js
// Purpose:   Render the tooltip's usage chart (session, weekly and Tk lines on one plot) as a transparent PNG data URI.
// Language:  JavaScript (CommonJS)
//
// x is the share of each gauge's own window: start to reset for session and weekly, and for Tk
// the share of the auto-compact point used. y is % used, so the faint diagonal is on pace.
// Each line is solid so far and faded at the current burn, with a marker where a projection hits
// 100% before its reset. The labels are the tooltip's text lines, coloured to match.
// No vscode import: the caller passes the theme kind.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const { createRaster, fillRect, dashedLine, diamond } = require('./raster');
const { encodePng } = require('./png');
const { TIER_COLORS } = require('./tk/colorMap');

// CSS pixels. Drawn at `scale` times that, and shown at the CSS size.
const LAYOUT = { width: 240, height: 128, scale: 2 };

// The first three slots of a CVD-checked categorical palette (blue, orange, aqua), stepped per theme.
// Every pair clears the colour-blind and normal-vision separation floors in both themes.
const SERIES_COLOURS = {
    dark: { session: '#3987e5', weekly: '#d95926', tokens: '#199e70' },
    light: { session: '#2a78d6', weekly: '#eb6834', tokens: '#1baf7a' },
};

const isLight = (themeKind) => themeKind === 1 || themeKind === 4;

// The hex each gauge's line is drawn in, for the tooltip to colour its labels to match.
function seriesColours(themeKind) {
    return SERIES_COLOURS[isLight(themeKind) ? 'light' : 'dark'];
}

const rgba = (hex, a = 255) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), a];

// VS Code's ColorThemeKind: 1 light, 2 dark, 3 high contrast, 4 high contrast light.
function paletteFor(themeKind) {
    const strong = themeKind === 3 || themeKind === 4;
    const ink = isLight(themeKind) ? [51, 51, 51] : [204, 204, 204];
    const series = seriesColours(themeKind);
    return {
        guide: [...ink, strong ? 140 : 70],
        error: rgba(TIER_COLORS.error.hex),
        session: rgba(series.session),
        weekly: rgba(series.weekly),
        tokens: rgba(series.tokens),
    };
}

// A session or weekly line, or null with no open window. Points are { x, y } in percent.
function usageSeries(key, analysis, now) {
    if (!analysis || analysis.state === 'idle' || analysis.state === 'expired') return null;
    const { startMs, windowMs, resetsAt, latest } = analysis;
    const xOf = (ts) => (100 * (ts - startMs)) / windowMs;
    const lived = [
        { x: 0, y: 0 },
        ...analysis.points.filter((p) => p.ts > startMs).map((p) => ({ x: xOf(p.ts), y: p.pct })),
        { x: xOf(Math.min(now, resetsAt)), y: latest.pct },
    ];
    let projection = null;
    let marker = null;
    if (analysis.ratePerHour !== null) {
        const hits = analysis.exhaustsAt !== null && analysis.exhaustsAt < resetsAt;
        const end = hits ? { x: xOf(analysis.exhaustsAt), y: 100 } : { x: 100, y: Math.min(100, analysis.projectedAtReset) };
        projection = [lived[lived.length - 1], end];
        if (hits && analysis.runsOut) marker = end;
    }
    return { key, lived, projection, marker };
}

// The Tk line, or null with no turns. x and y are both the share of the auto-compact point.
function tokenSeries(analysis, turns) {
    if (!analysis || !turns.length) return null;
    const pct = (tokens) => Math.min(100, (100 * tokens) / analysis.compactPoint);
    const lived = turns.map((t) => ({ x: pct(t.tokens), y: pct(t.tokens) }));
    const last = lived[lived.length - 1];
    const projection = analysis.state === 'ok' && analysis.tokensPerMinute > 0 && last.x < 100 ? [last, { x: 100, y: 100 }] : null;
    return { key: 'tokens', lived, projection, marker: null };
}

function drawChart(series, palette, { width, height, scale }) {
    const w = width * scale;
    const h = height * scale;
    const raster = createRaster(w, h);
    const pad = 3 * scale;
    const clamp = (v) => Math.min(100, Math.max(0, v));
    const px = (x) => pad + (clamp(x) / 100) * (w - 2 * pad);
    const py = (y) => h - pad - (clamp(y) / 100) * (h - 2 * pad);
    const hair = Math.max(1, scale / 2);

    fillRect(raster, pad, py(0), w - 2 * pad, hair, palette.guide);
    fillRect(raster, pad, py(100), w - 2 * pad, hair, palette.guide);
    dashedLine(raster, px(0), py(0), px(100), py(100), palette.guide, { dash: 2 * scale, gap: 3 * scale, thickness: hair });

    // Every line is the same 2 CSS px solid stroke. The projection is that stroke, faded.
    const stroke = 2 * scale;
    const line = (a, b, colour) => dashedLine(raster, px(a.x), py(a.y), px(b.x), py(b.y), colour, { dash: 1, gap: 0, thickness: stroke });
    for (const s of series) {
        const colour = palette[s.key];
        if (s.projection) line(s.projection[0], s.projection[1], [...colour.slice(0, 3), 110]);
        for (let i = 1; i < s.lived.length; i++) line(s.lived[i - 1], s.lived[i], colour);
        if (s.lived.length === 1) fillRect(raster, px(s.lived[0].x) - stroke, py(s.lived[0].y) - stroke, 2 * stroke, 2 * stroke, colour);
        if (s.marker) diamond(raster, px(s.marker.x), py(s.marker.y), 2 * scale, palette.error);
    }
    return encodePng(raster.width, raster.height, raster.data);
}

// What makes a new picture: a new sample or turn, the theme or a run-out state.
// The clock is deliberately not part of it, so the tooltip does not change under an open hover.
function cacheKey(input) {
    const latestOf = (analysis) => (analysis ? `${analysis.samples}@${analysis.latest.ts}@${analysis.state}` : '0');
    const { analyses, turns = [] } = input;
    const lastTurn = turns.length ? `${turns.length}@${turns[turns.length - 1].ts}@${analyses.tokens?.state}` : '0';
    return JSON.stringify([
        input.themeKind, latestOf(analyses.session), latestOf(analyses.weekly), lastTurn,
        analyses.session?.runsOut, analyses.weekly?.runsOut,
    ]);
}

let cached = null;

/**
 * The chart as a PNG data URI, or null when no gauge has anything to draw.
 *
 * @param {object} input
 * @param {{session?: object, weekly?: object, tokens?: object}} input.analyses - burn analyses from computeBurn
 * @param {{ts: number, tokens: number}[]} input.turns - Tk turns since the last compaction, oldest first
 * @param {number} input.themeKind - vscode.ColorThemeKind
 * @param {number} input.now
 */
function renderUsageChart(input, layout = LAYOUT) {
    const { analyses, turns = [], now } = input;
    const series = [
        usageSeries('session', analyses.session, now),
        usageSeries('weekly', analyses.weekly, now),
        tokenSeries(analyses.tokens, turns),
    ].filter(Boolean);
    if (series.length === 0) return null;

    const key = cacheKey(input) + JSON.stringify(layout);
    if (cached && cached.key === key) return cached.uri;
    const uri = `data:image/png;base64,${drawChart(series, paletteFor(input.themeKind), layout).toString('base64')}`;
    cached = { key, uri };
    return uri;
}

function resetChartCache() {
    cached = null;
}

module.exports = { LAYOUT, SERIES_COLOURS, seriesColours, renderUsageChart, resetChartCache };
