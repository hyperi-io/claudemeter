// The projection sentences, which are the chart's alt text and the lines under it.

import { describe, it, expect } from 'vitest';
const { MINUTE_MS, HOUR_MS } = require('../../src/burn');
const { formatSpan, projectionSentences } = require('../../src/projectionText');

const NOW = Date.UTC(2026, 9, 28, 0, 0, 0);
const at = (minutes) => NOW + minutes * MINUTE_MS;

describe('formatSpan', () => {
    it.each([
        [0, '0m'], [-5 * MINUTE_MS, '0m'], [29_000, '0m'], [31_000, '1m'], [50 * MINUTE_MS, '50m'], [59.6 * MINUTE_MS, '1h'],
        [60 * MINUTE_MS, '1h'], [80 * MINUTE_MS, '1h20'], [125 * MINUTE_MS, '2h05'], [24 * HOUR_MS, '1d 0h'], [77 * HOUR_MS, '3d 5h'],
    ])('%s ms is %s', (ms, expected) => {
        expect(formatSpan(ms)).toBe(expected);
    });
});

describe('projectionSentences', () => {
    const usage = (extra) => ({
        state: 'ok', latest: { ts: NOW, pct: 40 }, resetsAt: at(130), exhaustsAt: null, projectedAtReset: 60, runsOut: false, paceDelta: 0, ...extra,
    });
    const tk = (extra) => ({
        state: 'ok', pctOfCompact: 30, runwayMinutes: 32, runwayTurns: 40.4, ...extra,
    });

    it.each([
        ['a run-out before the reset says when and for how long it is blocked', usage({ exhaustsAt: at(80), runsOut: true, projectedAtReset: 140 }), 'Se out in 1h20, 50m blocked'],
        ['a slow burn says where it lands at the reset', usage({ projectedAtReset: 62.4 }), 'Se 62% at reset'],
        ['a projection past 100% with no held flag reads 100%', usage({ projectedAtReset: 180, exhaustsAt: at(200) }), 'Se 100% at reset'],
        ['a held flag inside the margin past the reset does not claim a run-out first', usage({ runsOut: true, exhaustsAt: at(140), projectedAtReset: 105 }), 'Se 100% at reset'],
        ['a full gauge says how long it is blocked', usage({ latest: { ts: NOW, pct: 100 } }), 'Se blocked for 2h10'],
        ['too few samples says nothing, the dots already do', usage({ state: 'measuring' }), undefined],
        ['no open window says nothing', usage({ state: 'idle' }), undefined],
        ['an expired window says nothing', usage({ state: 'expired' }), undefined],
        ['no analysis says nothing', null, undefined],
    ])('Se: %s', (_name, session, expected) => {
        expect(projectionSentences({ session, now: NOW })[0]).toBe(expected);
    });

    it('leaves the pace to the status bar', () => {
        const weekly = usage({ resetsAt: at(3 * 24 * 60), paceDelta: 40 });
        expect(projectionSentences({ weekly, now: NOW })).toEqual(['Wk 60% at reset']);
    });

    it('uses the configured labels', () => {
        expect(projectionSentences({ session: usage(), tokens: tk(), now: NOW, labels: { session: 'S5', tokens: 'Ctx' } }))
            .toEqual(['S5 60% at reset', 'Ctx compacts in 32m']);
    });

    it.each([
        ['a steady climb', tk(), 'Tk compacts in 32m'],
        ['a flat context says nothing', tk({ runwayMinutes: null, runwayTurns: null }), undefined],
        ['at the compact point', tk({ pctOfCompact: 101 }), 'Tk at auto-compact'],
        ['too few turns says nothing', tk({ state: 'measuring' }), undefined],
        ['no turns', null, undefined],
    ])('Tk: %s', (_name, tokens, expected) => {
        expect(projectionSentences({ tokens, now: NOW })[0]).toBe(expected);
    });

    it('lists the gauges in chart order, one short line each, and drops the silent ones', () => {
        const out = projectionSentences({ session: usage({ state: 'idle' }), weekly: usage(), tokens: tk(), now: NOW });
        expect(out).toEqual(['Wk 60% at reset', 'Tk compacts in 32m']);
        expect(Math.max(...out.map((l) => l.length))).toBeLessThanOrEqual(42);
    });
});
