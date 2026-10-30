// Burn rate, projection, hysteresis and strip slicing over usage history samples.
// Pure maths, so every case is a literal sample list and a literal `now`.

import { describe, it, expect } from 'vitest';
const {
    HOUR_MS, MINUTE_MS,
    splitWindows, burnRate, project, runOutFlag, paceDelta, sliceSeries, analyseUsage,
} = require('../../src/burn');
const { gaugeWindowMs } = require('../../src/gauges');

const FIVE_HOUR_MS = gaugeWindowMs('session');
const WEEK_MS = gaugeWindowMs('weekly');

const T0 = Date.UTC(2026, 9, 26, 0, 0, 0);
const RESET = T0 + FIVE_HOUR_MS;

// A sample at minute `min` after T0 with a five-hour gauge, plus any extra fields.
const five = (min, pct, resetsAt = RESET, extra = {}) => ({
    ts: T0 + min * MINUTE_MS,
    fiveHour: { pct, resetsAt },
    sevenDay: { pct: 10, resetsAt: T0 + WEEK_MS },
    scoped: {},
    ...extra,
});
const pts = (list) => list.map(([min, pct]) => ({ ts: T0 + min * MINUTE_MS, pct }));
// n samples two minutes apart rising by `step` points each.
const ramp = (n, step, from = 0) => Array.from({ length: n }, (_, k) => five(k * 2, from + k * step));

describe('splitWindows', () => {
    it.each([
        ['one steady window', [five(0, 1), five(2, 2), five(4, 3)], [3]],
        ['resetsAt moves by hours', [five(0, 40), five(2, 41), five(4, 2, RESET + FIVE_HOUR_MS)], [2, 1]],
        ['resetsAt wobbles by 500 ms', [five(0, 1), five(2, 2, RESET + 500), five(4, 3, RESET - 400)], [3]],
        ['percentage falls with the same resetsAt', [five(0, 40), five(2, 41), five(4, 0)], [2, 1]],
        ['percentage dips by rounding noise', [five(0, 40), five(2, 39.7), five(4, 41)], [3]],
        ['window opens after an idle null resetsAt', [five(0, 0, null), five(2, 0, null), five(4, 1)], [2, 1]],
        ['unordered input', [five(4, 3), five(0, 1), five(2, 2)], [3]],
        ['duplicate stamps keep one', [five(2, 2), five(2, 2), five(0, 1)], [2]],
        ['sample stamped an hour ahead is a wrong clock', [five(0, 1), five(2, 2), five(60, 3)], [2]],
        ['sample stamped 2 minutes ahead is clock jitter', [five(0, 1), five(2, 2), five(4, 3)], [3]],
        ['corrupt entries are skipped', [null, { ts: 'x' }, { ts: T0 }, five(0, 1), five(2, NaN)], [1]],
        ['no samples', [], []],
        ['undefined samples', undefined, []],
    ])('%s', (_name, samples, lengths) => {
        const now = T0 + 4 * MINUTE_MS;
        expect(splitWindows(samples, 'fiveHour', now).map((w) => w.length)).toEqual(lengths);
    });

    it('reads a scoped series by key and ignores samples without it', () => {
        const withScoped = (min, pct) => five(min, 1, RESET, { scoped: { 'scoped:sonnet': { pct, resetsAt: T0 + WEEK_MS } } });
        const windows = splitWindows([withScoped(0, 5), five(1, 1), withScoped(2, 6)], 'scoped:sonnet', T0 + HOUR_MS);
        expect(windows).toHaveLength(1);
        expect(windows[0].map((p) => p.pct)).toEqual([5, 6]);
    });
});

describe('burnRate', () => {
    it.each([
        ['no points', pts([])],
        ['one point', pts([[0, 5]])],
        ['two points', pts([[0, 5], [2, 6]])],
    ])('is measuring with %s', (_name, points) => {
        expect(burnRate(points)).toEqual({ state: 'measuring', ratePerHour: null });
    });

    it.each([
        ['steady 0.2 points per 2 minutes', ramp(20, 0.2).map((s) => ({ ts: s.ts, pct: s.fiveHour.pct })), 6],
        ['flat usage', pts([[0, 30], [2, 30], [4, 30], [6, 30]]), 0],
        ['a rounding dip never goes negative', pts([[0, 30], [2, 29.8], [4, 29.7], [6, 29.7]]), 0],
        ['three hours closed, then 9 points on reopening', pts([[0, 10], [2, 10.2], [4, 10.4], [184, 19.4]]), 3],
    ])('%s', (_name, points, perHour) => {
        const { state, ratePerHour } = burnRate(points);
        expect(state).toBe('ok');
        expect(ratePerHour).toBeCloseTo(perHour, 1);
    });

    it('smooths an idle burst, then decays it while usage stays flat', () => {
        const idle = Array.from({ length: 21 }, (_, k) => [k * 2, 20]);
        const burst = [...idle, [42, 26]];
        const afterBurst = burnRate(pts(burst)).ratePerHour;
        // 3 points per minute is 180 per hour, weighted by 1 - exp(-2/30).
        expect(afterBurst).toBeCloseTo(11.61, 1);
        const later = burnRate(pts([...burst, ...Array.from({ length: 15 }, (_, k) => [44 + k * 2, 26])])).ratePerHour;
        expect(later).toBeLessThan(afterBurst / 2);
        expect(later).toBeGreaterThan(0);
    });

    it('does not let closely spaced duplicate samples swamp the average', () => {
        const noisy = pts([[0, 10], [2, 10.2], [2.01, 10.4], [4, 10.4], [6, 10.6]]);
        expect(burnRate(noisy).ratePerHour).toBeLessThan(10);
    });
});

describe('project and runOutFlag', () => {
    const last = { ts: T0 + 3 * HOUR_MS, pct: 60 };

    // The reset is 2 hours after `last`, and 40 points remain.
    it.each([
        ['burn too slow to run out before the reset', 10, RESET, 80, last.ts + 4 * HOUR_MS],
        ['burn runs out before the reset', 40, RESET, 140, last.ts + 1 * HOUR_MS],
        ['flat burn', 0, RESET, 60, null],
        ['no burn measured', null, RESET, null, null],
        ['no open window', 10, null, null, null],
    ])('%s', (_name, rate, resetsAt, atReset, exhaustsAt) => {
        expect(project(last, rate, resetsAt)).toEqual({ atReset, exhaustsAt });
    });

    it('treats a full gauge as exhausted now', () => {
        expect(project({ ts: T0, pct: 100 }, 0, RESET).exhaustsAt).toBe(T0);
    });

    it.each([
        ['unset, 1 min before the reset', false, -1, true],
        ['unset, 1 min after the reset', false, 1, false],
        ['set, 10 min after the reset holds', true, 10, true],
        ['set, 20 min after the reset clears', true, 20, false],
        ['set, no longer exhausting', true, null, false],
        ['unset, no longer exhausting', false, null, false],
    ])('flag %s', (_name, wasSet, minutesPastReset, expected) => {
        const exhaustsAt = minutesPastReset === null ? null : RESET + minutesPastReset * MINUTE_MS;
        expect(runOutFlag(wasSet, exhaustsAt, RESET)).toBe(expected);
    });

    it('never flags without a reset to beat', () => {
        expect(runOutFlag(true, T0, null)).toBe(false);
    });
});

describe('paceDelta', () => {
    const now = T0 + WEEK_MS / 2;
    it.each([
        ['on pace at the half-way mark', 50, T0 + WEEK_MS, now, 0],
        ['11 points ahead', 61, T0 + WEEK_MS, now, 11],
        ['behind pace', 20, T0 + WEEK_MS, now, -30],
        ['window not open', 20, null, now, null],
        ['reset already passed counts the whole window', 80, T0, now, -20],
        ['reset more than a window away counts none of it', 5, now + 2 * WEEK_MS, now, 5],
    ])('%s', (_name, pct, resetsAt, at, expected) => {
        const delta = paceDelta(pct, resetsAt, at, WEEK_MS);
        if (expected === null) expect(delta).toBeNull();
        else expect(delta).toBeCloseTo(expected, 6);
    });
});

describe('sliceSeries', () => {
    const base = { startMs: T0, endMs: RESET, cells: 10 };
    const at = (hours) => T0 + hours * HOUR_MS;
    const mk = (list) => list.map(([h, pct]) => ({ ts: at(h), pct, resetsAt: RESET }));

    it('interpolates from the 0% window start and holds the last value up to now', () => {
        const cells = sliceSeries({ ...base, points: mk([[1, 10], [2, 20]]), now: at(2.5), ratePerHour: 10 });
        expect(cells.slice(0, 5).map((c) => c.value)).toEqual([5, 10, 15, 20, 20]);
        expect(cells.slice(5).every((c) => c.value === null)).toBe(true);
        expect(cells[5].projected).toBeCloseTo(30, 6);
        expect(cells[9].projected).toBeCloseTo(50, 6);
        expect(cells.every((c) => !c.blocked)).toBe(true);
    });

    it('interpolates across a gap instead of filling zeros', () => {
        const cells = sliceSeries({ ...base, points: mk([[0.5, 5], [4, 40]]), now: at(5), ratePerHour: null });
        // 2h sits 1.5 of the 3.5 hours from 5% to 40%.
        expect(cells[3].value).toBeCloseTo(5 + 35 * (1.5 / 3.5), 6);
        expect(cells.every((c) => c.value > 0)).toBe(true);
    });

    it('leaves every value null, never zero, when there are no samples', () => {
        const cells = sliceSeries({ ...base, points: [], now: at(2.5), ratePerHour: null });
        expect(cells.every((c) => c.value === null && c.projected === null && !c.blocked)).toBe(true);
    });

    it('draws a single sample as a line up from the 0% start', () => {
        const cells = sliceSeries({ ...base, points: mk([[1, 10]]), now: at(1.2), ratePerHour: null });
        expect(cells.slice(0, 2).map((c) => c.value)).toEqual([5, 10]);
    });

    it('ignores a sample from before the window opened', () => {
        const cells = sliceSeries({ ...base, points: [{ ts: T0 - HOUR_MS, pct: 90, resetsAt: RESET }, ...mk([[1, 10]])], now: at(1), ratePerHour: null });
        expect(cells[0].value).toBe(5);
    });

    it('caps the projection at 100 and blocks the cells after it', () => {
        const cells = sliceSeries({ ...base, points: mk([[3, 60]]), now: at(3), ratePerHour: 40 });
        // 60 + 40/h hits 100 at 4h.
        expect(cells[7].projected).toBe(100);
        expect(cells.map((c) => c.blocked)).toEqual([false, false, false, false, false, false, false, false, true, true]);
    });
});

describe('analyseUsage', () => {
    const now = T0 + 40 * MINUTE_MS;

    it('returns null with no samples', () => {
        expect(analyseUsage([], 'fiveHour', { now })).toBeNull();
    });

    it('is measuring below three samples and offers no projection', () => {
        const a = analyseUsage(ramp(2, 0.5), 'fiveHour', { now });
        expect(a).toMatchObject({ state: 'measuring', ratePerHour: null, projectedAtReset: null, runsOut: false });
    });

    it('projects the reset value and a run-out time from a steady burn', () => {
        // 30 points in 40 minutes of ramp, then 15 per hour of the remaining 4h20m is far past 100.
        const samples = ramp(21, 1.5, 30);
        const a = analyseUsage(samples, 'fiveHour', { now });
        expect(a.state).toBe('ok');
        expect(a.ratePerHour).toBeCloseTo(45, 1);
        expect(a.exhaustsAt).toBeLessThan(RESET);
        expect(a.runOutAt).toBe(a.exhaustsAt);
        expect(a.runsOut).toBe(true);
        expect(a.projectedAtReset).toBeGreaterThan(100);
    });

    it('reports no run-out when the burn is slow, and ends the window at its own projection', () => {
        const a = analyseUsage(ramp(21, 0.05), 'fiveHour', { now });
        expect(a.runOutAt).toBeNull();
        expect(a.runsOut).toBe(false);
        expect(a.projectedAtReset).toBeLessThan(100);
    });

    it('holds the run-out flag through a small dip in the projection, then clears it', () => {
        // exhaustsAt is 5 minutes past the reset: unset reads false, set reads true.
        const samples = ramp(21, 0.2, 90);
        const rate = analyseUsage(samples, 'fiveHour', { now }).ratePerHour;
        const last = samples[samples.length - 1];
        const needHours = (100 - last.fiveHour.pct) / rate;
        const lateReset = last.ts + needHours * HOUR_MS - 5 * MINUTE_MS;
        const shifted = samples.map((s) => ({ ...s, fiveHour: { ...s.fiveHour, resetsAt: lateReset } }));
        expect(analyseUsage(shifted, 'fiveHour', { now, flagged: false }).runsOut).toBe(false);
        expect(analyseUsage(shifted, 'fiveHour', { now, flagged: true }).runsOut).toBe(true);
    });

    it('uses only the samples after a reset mid-window', () => {
        const before = [five(0, 80, T0 + 30 * MINUTE_MS), five(2, 82, T0 + 30 * MINUTE_MS)];
        const after = Array.from({ length: 4 }, (_, k) => five(40 + k * 2, k * 0.1, T0 + 40 * MINUTE_MS + FIVE_HOUR_MS));
        const a = analyseUsage([...before, ...after], 'fiveHour', { now: T0 + 48 * MINUTE_MS });
        expect(a.samples).toBe(4);
        expect(a.latest.pct).toBeCloseTo(0.3, 6);
        expect(a.ratePerHour).toBeCloseTo(3, 1);
    });

    it('is idle while no window is open and expired once the reset has passed', () => {
        expect(analyseUsage([five(0, 0, null), five(2, 0, null)], 'fiveHour', { now })).toMatchObject({ state: 'idle', paceDelta: null });
        expect(analyseUsage(ramp(5, 1), 'fiveHour', { now: RESET + HOUR_MS })).toMatchObject({ state: 'expired', ratePerHour: null });
    });

    it('ignores a future-stamped sample from a wrong clock', () => {
        const a = analyseUsage([...ramp(5, 1), five(600, 99)], 'fiveHour', { now: T0 + 10 * MINUTE_MS });
        expect(a.latest.pct).toBe(4);
    });

    it('gives the weekly pace delta for the sevenDay series', () => {
        const half = T0 + WEEK_MS / 2;
        const week = (min, pct) => ({ ts: half + min * MINUTE_MS, fiveHour: { pct: 0, resetsAt: null }, sevenDay: { pct, resetsAt: T0 + WEEK_MS }, scoped: {} });
        const a = analyseUsage([week(0, 60), week(2, 60.1), week(4, 60.2)], 'sevenDay', { now: half + 4 * MINUTE_MS });
        expect(a.windowMs).toBe(WEEK_MS);
        expect(a.paceDelta).toBeGreaterThan(10);
    });

    it('takes a configured window length for the start and the pace', () => {
        const fiveDays = 5 * 24 * HOUR_MS;
        const resetsAt = T0 + fiveDays;
        const half = T0 + fiveDays / 2;
        const week = (min, pct) => ({ ts: half + min * MINUTE_MS, fiveHour: { pct: 0, resetsAt: null }, sevenDay: { pct, resetsAt }, scoped: {} });
        const a = analyseUsage([week(0, 50), week(2, 50), week(4, 50)], 'sevenDay', { now: half + 4 * MINUTE_MS, windowMs: fiveDays });
        expect(a.startMs).toBe(T0);
        // A 7 day window would put the same reading 14 points behind.
        expect(a.paceDelta).toBeCloseTo(0, 0);
    });
});
