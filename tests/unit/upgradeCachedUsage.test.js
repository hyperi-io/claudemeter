// Tests for upgrading a cached usageData written by an older bundle. The
// cross-window cache is shared, and after an update windows reload at
// different times, so an older writer's shape must not blank a newer reader's
// gauges - the account-global meters render identically in every window.

import { describe, it, expect } from 'vitest';
const { upgradeCachedUsage } = require('../../src/apiSchema');

// The limits[] shape Anthropic reports, as captured from a live payload.
const RAW = {
    five_hour: { utilization: 3, resets_at: '2026-01-01T08:10:00Z' },
    seven_day: { utilization: 28, resets_at: '2026-01-04T06:00:00Z' },
    seven_day_opus: null,
    seven_day_sonnet: null,
    limits: [
        { kind: 'session', group: 'session', percent: 3, scope: null },
        { kind: 'weekly_all', group: 'weekly', percent: 28, scope: null },
        {
            kind: 'weekly_scoped',
            group: 'weekly',
            percent: 3,
            resets_at: '2026-01-04T05:59:59Z',
            scope: { model: { id: null, display_name: 'Fable' }, surface: null },
        },
    ],
};

// A cache entry written by a bundle predating scopedWeekly: named per-model
// fields instead, no scopedWeekly key, rawData carried verbatim.
function oldShape() {
    return {
        usagePercent: 3,
        usagePercentWeek: 28,
        usagePercentOpus: null,
        usagePercentSonnet: null,
        rawData: JSON.parse(JSON.stringify(RAW)),
        limits: RAW.limits,
        schemaVersion: '2.0',
    };
}

describe('upgradeCachedUsage - an old writer must not blank a new reader', () => {
    it('recomputes scopedWeekly from the cached rawData', () => {
        const upgraded = upgradeCachedUsage(oldShape());
        expect(upgraded.scopedWeekly).toHaveLength(1);
        expect(upgraded.scopedWeekly[0]).toMatchObject({ label: 'Fable', percent: 3 });
    });

    it('recovers limits when the writer predates that field too', () => {
        const cached = oldShape();
        delete cached.limits;
        expect(upgradeCachedUsage(cached).limits).toBe(cached.rawData.limits);
    });

    it('leaves a current-shape entry untouched', () => {
        const cached = oldShape();
        cached.scopedWeekly = [{ label: 'Fable', percent: 2 }];
        expect(upgradeCachedUsage(cached).scopedWeekly).toEqual([{ label: 'Fable', percent: 2 }]);
    });

    it('leaves an EMPTY scopedWeekly alone - the payload really had none', () => {
        const cached = oldShape();
        cached.scopedWeekly = [];
        expect(upgradeCachedUsage(cached).scopedWeekly).toEqual([]);
    });

    it('falls back to the legacy named fields when rawData has no limits', () => {
        const cached = oldShape();
        cached.rawData.limits = [];
        cached.rawData.seven_day_sonnet = { utilization: 12, resets_at: '2026-01-04T06:00:00Z' };
        const upgraded = upgradeCachedUsage(cached);
        expect(upgraded.scopedWeekly).toHaveLength(1);
        expect(upgraded.scopedWeekly[0]).toMatchObject({ label: 'Sonnet', percent: 12 });
    });

    it('does nothing without rawData to derive from', () => {
        const cached = { usagePercent: 3 };
        expect(upgradeCachedUsage(cached).scopedWeekly).toBeUndefined();
    });

    it('passes null and undefined through', () => {
        expect(upgradeCachedUsage(null)).toBeNull();
        expect(upgradeCachedUsage(undefined)).toBeUndefined();
    });
});
