// Project:   Claudemeter
// File:      stripGauge.js
// Purpose:   Turn usage history and the Tk turn series into status bar strip glyphs, run-out countdowns and the weekly pace delta.
// Language:  JavaScript (CommonJS)
//
// Each strip cell is one slice of the window's time axis, drawn from the bundled icon font
// (package.json contributes.icons): a filled bar for a slice already lived, a hollow bar for
// one at the current burn, and a blocked mark once the projection has hit 100%.
// No vscode import, so every function takes `now` as an argument.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const { analyseUsage, sliceSeries, MINUTE_MS, HOUR_MS } = require('./burn');
const { analyseTurns } = require('./tk/series');

const STRIP_CELLS = 5;
// A week's usage must be ahead of the clock by more than this many points to earn a "+N" beside Wk.
const PACE_DELTA_MIN_POINTS = 10;
// The Tk axis never stretches past this many multiples of the session so far, so a slow burn leaves the lived part readable.
const TK_AXIS_MAX_SPANS = 4;

const icon = (name) => `$(claudemeter-${name})`;

// 1 to 8 eighths of the glyph height, so any use at all shows a bar and 100% is a full one.
function eighths(pct) {
    return Math.min(8, Math.max(1, Math.ceil(pct / 12.5)));
}

// A slice already lived beats a blocked one, because a stale last sample can put the exhaustion time behind `now`.
function cellGlyph(cell) {
    if (cell.value !== null) return icon(`bar-${eighths(cell.value)}`);
    if (cell.blocked) return icon('blocked');
    if (cell.projected !== null) return icon(`barh-${eighths(cell.projected)}`);
    return null;
}

function stripOf(cells) {
    const glyphs = cells.map(cellGlyph);
    return glyphs.every(Boolean) ? glyphs.join('') : null;
}

/**
 * Burn analysis and strip for one usage gauge.
 *
 * @param {object[]} samples - usage history samples
 * @param {string} series - 'fiveHour', 'sevenDay' or a scoped key
 * @param {{now: number, flagged?: boolean, windowMs?: number, cells?: number}} options - windowMs defaults to the built-in gauge's
 * @returns {{analysis: object|null, strip: string|null}} strip is null while measuring or with no open window
 */
function usageGauge(samples, series, { now, flagged = false, windowMs, cells = STRIP_CELLS }) {
    const analysis = analyseUsage(samples, series, { now, flagged, ...(windowMs ? { windowMs } : {}) });
    if (!analysis || analysis.state !== 'ok') return { analysis, strip: null };
    const strip = stripOf(sliceSeries({
        points: analysis.points,
        startMs: analysis.startMs,
        endMs: analysis.resetsAt,
        now,
        cells,
        ratePerHour: analysis.ratePerHour,
    }));
    return { analysis, strip };
}

/**
 * The Tk axis: from the first turn since the last compaction to the projected auto-compact
 * point, with the height as the share of that point used. Shared by the strip and the tooltip chart.
 *
 * @param {{ts: number, tokens: number}[]} turns - main-session turns, oldest first
 * @param {object} analysis - analyseTurns result in the 'ok' state
 */
function tkAxis(turns, analysis, now) {
    const { compactPoint, latest } = analysis;
    const points = turns.map((t) => ({ ts: t.ts, pct: (100 * t.tokens) / compactPoint }));
    const ratePerHour = ((analysis.tokensPerMinute * 60) / compactPoint) * 100;
    const startMs = turns[0].ts;
    const cap = startMs + TK_AXIS_MAX_SPANS * Math.max(latest.ts - startMs, 5 * MINUTE_MS);
    const reachesAt = ratePerHour > 0 ? latest.ts + ((100 - points[points.length - 1].pct) / ratePerHour) * HOUR_MS : cap;
    const endMs = Math.max(Math.min(reachesAt, cap), latest.ts + MINUTE_MS, now + MINUTE_MS);
    return { points, ratePerHour, startMs, endMs };
}

/**
 * Burn analysis and strip for the Tk gauge.
 *
 * @param {{ts: number, tokens: number}[]} turns - main-session turns, oldest first
 */
function tkGauge(turns, { profile, contextWindow, now, cells = STRIP_CELLS }) {
    const analysis = analyseTurns(turns, { profile, contextWindow, now });
    if (!analysis || analysis.state !== 'ok') return { analysis, strip: null };
    const { points, ratePerHour, startMs, endMs } = tkAxis(turns, analysis, now);
    const strip = stripOf(sliceSeries({ points, startMs, endMs, now, cells, ratePerHour, startPct: points[0].pct }));
    return { analysis, strip };
}

// True when a held run-out flag should tint the gauge the warning colour. The reset clock stays.
function runOutWarning(analysis, showProjection) {
    return !!(showProjection && analysis?.runsOut && analysis.exhaustsAt !== null);
}

// "+11" when a week's usage is that many points ahead of the clock, else ''.
function paceText(analysis, showProjection) {
    if (!showProjection || !analysis || analysis.paceDelta === null) return '';
    return analysis.paceDelta > PACE_DELTA_MIN_POINTS ? `+${Math.round(analysis.paceDelta)}` : '';
}

module.exports = {
    STRIP_CELLS,
    PACE_DELTA_MIN_POINTS,
    eighths,
    cellGlyph,
    stripOf,
    usageGauge,
    tkAxis,
    tkGauge,
    runOutWarning,
    paceText,
};
