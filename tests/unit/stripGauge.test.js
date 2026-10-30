// Strip glyph mapping, the measuring fallback, the run-out countdown swap and the weekly pace text.
// Pure functions over literal samples, so each case names its numbers.

import { describe, it, expect } from 'vitest';
const { PROFILES } = require('../../src/tk/profiles');
const { HOUR_MS, MINUTE_MS } = require('../../src/burn');
const { gaugeWindowMs } = require('../../src/gauges');

const FIVE_HOUR_MS = gaugeWindowMs('session');
const {
    PACE_DELTA_MIN_POINTS, eighths, cellGlyph, stripOf, usageGauge, tkGauge, runOutWarning, paceText,
} = require('../../src/stripGauge');

const T0 = Date.UTC(2026, 9, 26, 0, 0, 0);
const RESET = T0 + FIVE_HOUR_MS;
const bar = (n) => `$(claudemeter-bar-${n})`;
const barh = (n) => `$(claudemeter-barh-${n})`;
const BLOCKED = '$(claudemeter-blocked)';

// A sample every 15 minutes from the window start, rising `perHour` points an hour, up to `hours` in.
function climb(perHour, hours) {
    const out = [];
    for (let h = 0; h <= hours + 1e-9; h += 0.25) {
        out.push({
            ts: T0 + h * HOUR_MS,
            fiveHour: { pct: perHour * h, resetsAt: RESET },
            sevenDay: { pct: 1, resetsAt: T0 + 7 * 24 * HOUR_MS },
            scoped: {},
        });
    }
    return out;
}

describe('eighths', () => {
    it.each([
        [0, 1], [1, 1], [12.5, 1], [12.6, 2], [37.5, 3], [50, 4], [93.8, 8], [99, 8], [100, 8], [250, 8], [-5, 1],
    ])('%s%% is %s eighths', (pct, expected) => {
        expect(eighths(pct)).toBe(expected);
    });
});

describe('cellGlyph', () => {
    it.each([
        ['a lived slice is a filled bar', { value: 40, projected: null, blocked: false }, bar(4)],
        ['a projected slice is a hollow bar', { value: null, projected: 60, blocked: false }, barh(5)],
        ['a slice after the 100% point is blocked', { value: null, projected: 100, blocked: true }, BLOCKED],
        ['a lived slice beats blocked when the last sample is stale', { value: 70, projected: null, blocked: true }, bar(6)],
        ['a slice with nothing to draw has no glyph', { value: null, projected: null, blocked: false }, null],
    ])('%s', (_name, cell, expected) => {
        expect(cellGlyph(cell)).toBe(expected);
    });

    it('draws no strip at all if any cell cannot be drawn', () => {
        expect(stripOf([{ value: 10, projected: null, blocked: false }, { value: null, projected: null, blocked: false }])).toBeNull();
    });
});

describe('usageGauge', () => {
    it.each([
        ['one sample', climb(10, 0)],
        ['two samples', climb(10, 0.25)],
        ['no samples', []],
    ])('has no strip while measuring: %s', (_name, samples) => {
        expect(usageGauge(samples, 'fiveHour', { now: T0 + 3 * MINUTE_MS }).strip).toBeNull();
    });

    it('draws filled bars to now, then hollow bars at the burn', () => {
        // 10 points an hour, 2.5 hours in: slices end at 1h, 2h, then 3h, 4h, 5h are projected.
        const { analysis, strip } = usageGauge(climb(10, 2.5), 'fiveHour', { now: T0 + 2.5 * HOUR_MS });
        expect(analysis.state).toBe('ok');
        expect(strip).toBe([bar(1), bar(2), barh(3), barh(4), barh(4)].join(''));
    });

    it('blocks the slices after the projection reaches 100%', () => {
        // 40 an hour hits 100% at 2.5h of 5h, so the 4th and 5th slices are blocked.
        const { strip } = usageGauge(climb(40, 1.5), 'fiveHour', { now: T0 + 1.5 * HOUR_MS });
        expect(strip).toBe([bar(4), barh(7), barh(8), BLOCKED, BLOCKED].join(''));
    });

    it('draws a flat hollow line when usage has stopped', () => {
        const samples = climb(0, 1).map((s) => ({ ...s, fiveHour: { ...s.fiveHour, pct: 25 } }));
        const { strip } = usageGauge(samples, 'fiveHour', { now: T0 + HOUR_MS });
        expect(strip).toBe([bar(2), barh(2), barh(2), barh(2), barh(2)].join(''));
    });

    it('draws no strip once the window has ended or before one has opened', () => {
        expect(usageGauge(climb(10, 2), 'fiveHour', { now: RESET + HOUR_MS }).strip).toBeNull();
        const idle = climb(0, 1).map((s) => ({ ...s, fiveHour: { pct: 0, resetsAt: null } }));
        expect(usageGauge(idle, 'fiveHour', { now: T0 + HOUR_MS }).strip).toBeNull();
    });
});

describe('tkGauge', () => {
    const ctx = { profile: PROFILES.pro, contextWindow: 200_000 };
    // 20K tokens a turn, a turn a minute, against an auto-compact point of 167K.
    const turns = [50, 70, 90, 110].map((k, i) => ({ ts: T0 + i * MINUTE_MS, tokens: k * 1000 }));

    it('runs the axis to the projected auto-compact point', () => {
        const { analysis, strip } = tkGauge(turns, { ...ctx, now: T0 + 3 * MINUTE_MS });
        expect(analysis.compactPoint).toBe(167_000);
        expect(strip).toBe([bar(4), bar(5), barh(6), barh(7), barh(8)].join(''));
    });

    it.each([
        ['two turns', turns.slice(0, 2)],
        ['one turn', turns.slice(0, 1)],
    ])('has no strip with %s', (_name, few) => {
        const { analysis, strip } = tkGauge(few, { ...ctx, now: T0 + 3 * MINUTE_MS });
        expect(analysis.state).toBe('measuring');
        expect(strip).toBeNull();
    });

    it('returns nothing for a session with no turns', () => {
        expect(tkGauge([], { ...ctx, now: T0 })).toEqual({ analysis: null, strip: null });
    });

    it('keeps the lived part readable when the burn has all but stopped', () => {
        // 20 minutes at 100 tokens a turn: the axis stops at 4 times the session so far, not at the far-off compact point.
        const slow = Array.from({ length: 21 }, (_, i) => ({ ts: T0 + i * MINUTE_MS, tokens: 100_000 + i * 100 }));
        const { strip } = tkGauge(slow, { ...ctx, now: T0 + 20 * MINUTE_MS });
        expect(strip.startsWith(bar(5))).toBe(true);
        expect(strip).not.toContain(BLOCKED);
    });

    it('marks the cells after a full context as blocked', () => {
        const full = [150, 160, 170].map((k, i) => ({ ts: T0 + i * MINUTE_MS, tokens: k * 1000 }));
        const { strip } = tkGauge(full, { ...ctx, now: T0 + 2 * MINUTE_MS });
        expect(strip.endsWith(BLOCKED)).toBe(true);
    });
});

describe('runOutWarning', () => {
    const analysis = (extra) => ({ runsOut: false, exhaustsAt: null, resetsAt: RESET, ...extra });
    it.each([
        ['a held flag warns', analysis({ runsOut: true, exhaustsAt: T0 + HOUR_MS }), true, true],
        ['showProjection off does not', analysis({ runsOut: true, exhaustsAt: T0 + HOUR_MS }), false, false],
        ['no flag does not', analysis({ exhaustsAt: T0 + HOUR_MS }), true, false],
        ['a flag with no exhaustion time does not', analysis({ runsOut: true }), true, false],
        ['no analysis does not', null, true, false],
    ])('%s', (_name, a, show, expected) => {
        expect(runOutWarning(a, show)).toBe(expected);
    });
});

describe('paceText', () => {
    it.each([
        ['well ahead', 14.6, true, '+15'],
        ['just over the threshold', PACE_DELTA_MIN_POINTS + 0.4, true, '+10'],
        ['exactly at the threshold', PACE_DELTA_MIN_POINTS, true, ''],
        ['on pace', 0, true, ''],
        ['behind', -30, true, ''],
        ['ahead but showProjection off', 40, false, ''],
        ['no reset to measure against', null, true, ''],
    ])('%s', (_name, paceDelta, show, expected) => {
        expect(paceText({ paceDelta }, show)).toBe(expected);
    });

    it('is empty with no analysis', () => {
        expect(paceText(null, true)).toBe('');
    });
});
