// Project:   Claudemeter
// File:      burn.js
// Purpose:   Pure burn-rate, projection and strip-slice maths over usage history samples.
// Language:  JavaScript (CommonJS)
//
// A sample is { ts, fiveHour: {pct, resetsAt}, sevenDay: {pct, resetsAt}, scoped: {key: {pct, resetsAt}} }
// with ts and resetsAt in epoch ms (see usageHistory.js). A series names one gauge:
// 'fiveHour', 'sevenDay' or a scoped key. Window lengths come from the gauge table (gauges.js).
// No vscode import and no I/O.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const { gaugeWindowMs } = require('./gauges');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

// A reading loses 63% of its weight after this long.
const BURN_TAU_MS = 30 * MINUTE_MS;
const MIN_SAMPLES = 3;

// resetsAt wobbles by sub-second amounts between fetches, a real reset moves it hours.
const RESET_JITTER_MS = MINUTE_MS;
// Utilisation only grows inside a window, so a fall bigger than rounding is a reset.
const RESET_DROP_PCT = 0.5;
// Samples stamped further ahead than this come from a wrong clock.
const CLOCK_SKEW_MS = 5 * MINUTE_MS;
// The run-out flag holds until the projection clears the reset by this much.
const RUN_OUT_CLEAR_MARGIN_MS = 15 * MINUTE_MS;

// The built-in window of a series, for a caller that passes no windowMs of its own.
function defaultWindowMs(series) {
    return gaugeWindowMs(series === 'fiveHour' ? 'session' : series === 'sevenDay' ? 'weekly' : 'scoped');
}

// The { ts, pct, resetsAt } of one gauge in one sample, or null when it carries none.
function pointOf(sample, series) {
    if (!sample || !Number.isFinite(sample.ts)) return null;
    const g = series === 'fiveHour' || series === 'sevenDay' ? sample[series] : sample.scoped?.[series];
    if (!g || !Number.isFinite(g.pct)) return null;
    return { ts: sample.ts, pct: g.pct, resetsAt: Number.isFinite(g.resetsAt) ? g.resetsAt : null };
}

// A new window began between two consecutive points of one gauge.
function isWindowBoundary(prev, cur) {
    if ((prev.resetsAt === null) !== (cur.resetsAt === null)) return true;
    if (prev.resetsAt !== null && Math.abs(cur.resetsAt - prev.resetsAt) > RESET_JITTER_MS) return true;
    return cur.pct < prev.pct - RESET_DROP_PCT;
}

// Every window the samples cover, oldest first, each a time-ordered list of points.
// Unordered, duplicate-stamped and future-stamped samples are tolerated.
function splitWindows(samples, series, now) {
    const byTs = new Map();
    for (const s of samples || []) {
        const p = pointOf(s, series);
        if (p && p.ts <= now + CLOCK_SKEW_MS) byTs.set(p.ts, p);
    }
    const points = [...byTs.values()].sort((a, b) => a.ts - b.ts);
    const windows = [];
    for (const p of points) {
        const run = windows[windows.length - 1];
        if (run && !isWindowBoundary(run[run.length - 1], p)) run.push(p);
        else windows.push([p]);
    }
    return windows;
}

// The window the newest sample belongs to, or null with no samples.
// startMs is null while no window is open (resetsAt null).
function currentWindow(samples, series, now, windowMs = defaultWindowMs(series)) {
    const windows = splitWindows(samples, series, now);
    const points = windows[windows.length - 1];
    if (!points) return null;
    const { resetsAt } = points[points.length - 1];
    return {
        points,
        resetsAt,
        windowMs,
        startMs: resetsAt === null ? null : resetsAt - windowMs,
        expired: resetsAt !== null && resetsAt <= now,
    };
}

// Time-weighted EWMA of the rate between consecutive { ts, v } points, in v per ms,
// or null under MIN_SAMPLES points. Weighting by elapsed time keeps a burst of
// closely spaced samples from swamping the average.
function smoothedRate(points, tauMs = BURN_TAU_MS) {
    if (points.length < MIN_SAMPLES) return null;
    let rate = null;
    for (let i = 1; i < points.length; i++) {
        const dt = points[i].ts - points[i - 1].ts;
        if (dt <= 0) continue;
        const r = (points[i].v - points[i - 1].v) / dt;
        rate = rate === null ? r : rate + (1 - Math.exp(-dt / tauMs)) * (r - rate);
    }
    return rate === null ? null : Math.max(0, rate);
}

// { state: 'measuring' | 'ok', ratePerHour } in percentage points per hour.
function burnRate(points, tauMs = BURN_TAU_MS) {
    const rate = smoothedRate(points.map((p) => ({ ts: p.ts, v: p.pct })), tauMs);
    return rate === null
        ? { state: 'measuring', ratePerHour: null }
        : { state: 'ok', ratePerHour: rate * HOUR_MS };
}

// Straight line from the last point. exhaustsAt is when it reaches 100%, before the reset or not.
function project(last, ratePerHour, resetsAt) {
    if (ratePerHour === null || resetsAt === null) return { atReset: null, exhaustsAt: null };
    const atReset = last.pct + (ratePerHour * Math.max(0, resetsAt - last.ts)) / HOUR_MS;
    let exhaustsAt = null;
    if (last.pct >= 100) exhaustsAt = last.ts;
    else if (ratePerHour > 0) exhaustsAt = last.ts + ((100 - last.pct) / ratePerHour) * HOUR_MS;
    return { atReset, exhaustsAt };
}

// Sets when the projection hits 100% before the reset, clears only once it is a margin past it.
function runOutFlag(wasSet, exhaustsAt, resetsAt, clearMarginMs = RUN_OUT_CLEAR_MARGIN_MS) {
    if (exhaustsAt === null || resetsAt === null) return false;
    return exhaustsAt < (wasSet ? resetsAt + clearMarginMs : resetsAt);
}

// Percentage points used above the share of the window elapsed. Positive is ahead of pace.
function paceDelta(pct, resetsAt, now, windowMs) {
    if (resetsAt === null) return null;
    const elapsed = Math.min(windowMs, Math.max(0, windowMs - (resetsAt - now)));
    return pct - (100 * elapsed) / windowMs;
}

// Value of a time-ordered { ts, pct } list at t: linear between neighbours, flat outside them.
function valueAt(known, t) {
    if (t <= known[0].ts) return known[0].pct;
    const last = known[known.length - 1];
    if (t >= last.ts) return last.pct;
    let lo = 0;
    let hi = known.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (known[mid].ts <= t) lo = mid;
        else hi = mid;
    }
    const a = known[lo];
    const b = known[hi];
    return a.pct + ((b.pct - a.pct) * (t - a.ts)) / (b.ts - a.ts);
}

// Cut [startMs, endMs] into `cells` slices of { start, end, value, projected, blocked }.
// value is the consumed % at the slice end (null once it passes `now`), taken from a 0% window start.
function sliceSeries({ points, startMs, endMs, now, cells, ratePerHour = null, startPct = 0 }) {
    const size = (endMs - startMs) / cells;
    const last = points[points.length - 1];
    const known = last ? [{ ts: startMs, pct: startPct }, ...points.filter((p) => p.ts > startMs)] : null;
    const exhaustsAt = last ? project(last, ratePerHour, endMs).exhaustsAt : null;
    const out = [];
    for (let i = 0; i < cells; i++) {
        const start = startMs + i * size;
        const end = start + size;
        const past = end <= now;
        let projected = null;
        if (!past && last && ratePerHour !== null) {
            projected = Math.min(100, last.pct + (ratePerHour * Math.max(0, end - last.ts)) / HOUR_MS);
        }
        out.push({
            start,
            end,
            value: past && known ? valueAt(known, end) : null,
            projected,
            blocked: exhaustsAt !== null && exhaustsAt <= start,
        });
    }
    return out;
}

const NO_PROJECTION = {
    ratePerHour: null,
    projectedAtReset: null,
    exhaustsAt: null,
    runOutAt: null,
    runsOut: false,
    paceDelta: null,
};

// Everything a gauge needs for one series, or null with no samples. state is 'idle' (no
// open window), 'expired' (reset passed, no newer sample), 'measuring' (under 3 samples) or 'ok'.
// `flagged` is the previous call's runsOut, which carries the hysteresis.
function analyseUsage(samples, series, { now = Date.now(), flagged = false, windowMs = defaultWindowMs(series) } = {}) {
    const win = currentWindow(samples, series, now, windowMs);
    if (!win) return null;
    const latest = win.points[win.points.length - 1];
    const base = {
        points: win.points,
        latest,
        resetsAt: win.resetsAt,
        startMs: win.startMs,
        windowMs: win.windowMs,
        samples: win.points.length,
    };
    if (win.resetsAt === null) return { ...base, ...NO_PROJECTION, state: 'idle' };
    if (win.expired) return { ...base, ...NO_PROJECTION, state: 'expired' };

    const { state, ratePerHour } = burnRate(win.points);
    const { atReset, exhaustsAt } = project(latest, ratePerHour, win.resetsAt);
    return {
        ...base,
        state,
        ratePerHour,
        projectedAtReset: atReset,
        exhaustsAt,
        runOutAt: exhaustsAt !== null && exhaustsAt < win.resetsAt ? exhaustsAt : null,
        runsOut: runOutFlag(flagged, exhaustsAt, win.resetsAt),
        paceDelta: paceDelta(latest.pct, win.resetsAt, now, win.windowMs),
    };
}

module.exports = {
    HOUR_MS,
    MINUTE_MS,
    BURN_TAU_MS,
    MIN_SAMPLES,
    RUN_OUT_CLEAR_MARGIN_MS,
    splitWindows,
    currentWindow,
    smoothedRate,
    burnRate,
    project,
    runOutFlag,
    paceDelta,
    valueAt,
    sliceSeries,
    analyseUsage,
};
