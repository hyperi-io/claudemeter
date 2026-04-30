// Tests for claudeLabelComposer.js — composes the leftmost "Claude"
// status-bar panel from platform-wide state (service status, refresh
// spinner). Pure function. Happy hour has its own dedicated panel
// (statusBar.renderHappyHourPanel) and is NOT part of this module.

import { describe, it, expect } from 'vitest';
const {
    composeClaudeLabel,
} = require('../../src/claudeLabelComposer');

describe('composeClaudeLabel — baseline', () => {
    it('no state → just "Claude"', () => {
        const r = composeClaudeLabel({});
        expect(r.text).toBe('Claude');
        expect(r.color).toBeUndefined();
        expect(r.backgroundColor).toBeUndefined();
        expect(r.tooltipLines).toEqual([]);
    });

    it('undefined input treated as empty state', () => {
        const r = composeClaudeLabel();
        expect(r.text).toBe('Claude');
    });

    it('service status "none" (operational) shows nothing', () => {
        const r = composeClaudeLabel({ serviceStatus: { indicator: 'none' } });
        expect(r.text).toBe('Claude');
        expect(r.color).toBeUndefined();
        expect(r.backgroundColor).toBeUndefined();
    });
});

describe('composeClaudeLabel — service status icons', () => {
    it('degraded (minor) shows $(pulse) yellow, no background', () => {
        const r = composeClaudeLabel({ serviceStatus: { indicator: 'minor' } });
        expect(r.text).toContain('$(pulse)');
        expect(r.color).toBe('charts.yellow');
        expect(r.backgroundColor).toBeUndefined();
    });

    it('partial outage (major) shows $(warning) red, no background', () => {
        const r = composeClaudeLabel({ serviceStatus: { indicator: 'major' } });
        expect(r.text).toContain('$(warning)');
        expect(r.color).toBe('claudemeter.outageRed');
        expect(r.backgroundColor).toBeUndefined();
    });

    it('major outage (critical) shows $(error) red with red background and the dead-Jim quirkyOverride', () => {
        const r = composeClaudeLabel({ serviceStatus: { indicator: 'critical' } });
        expect(r.text).toContain('$(error)');
        expect(r.color).toBe('claudemeter.outageRed');
        expect(r.backgroundColor).toBe('statusBarItem.errorBackground');
        // Quote is exposed as quirkyOverride (replaces the activity quip),
        // not as an extra tooltip line.
        expect(r.quirkyOverride).toBe("He's dead, Jim.");
        expect(r.tooltipLines.some(l => l.includes('Jim'))).toBe(false);
    });

    it('non-critical states have no quirkyOverride', () => {
        for (const ind of ['minor', 'major', 'none', 'unknown']) {
            const r = composeClaudeLabel({ serviceStatus: { indicator: ind } });
            expect(r.quirkyOverride).toBeUndefined();
        }
    });

    it('unknown shows $(question) with no colour or background', () => {
        const r = composeClaudeLabel({ serviceStatus: { indicator: 'unknown' } });
        expect(r.text).toContain('$(question)');
        expect(r.backgroundColor).toBeUndefined();
    });

    it('appends description when different from label', () => {
        const r = composeClaudeLabel({
            serviceStatus: { indicator: 'minor', description: 'API elevated latency' },
        });
        expect(r.tooltipLines[0]).toMatch(/API elevated latency/);
    });
});

describe('composeClaudeLabel — combined states', () => {
    it('refreshing appended as $(loading) at the end', () => {
        const r = composeClaudeLabel({
            serviceStatus: { indicator: 'minor' },
            isRefreshing: true,
        });
        expect(r.text).toBe('Claude $(pulse) $(loading)');
    });

    it('refreshing alone just appends the spinner', () => {
        const r = composeClaudeLabel({ isRefreshing: true });
        expect(r.text).toBe('Claude $(loading)');
    });
});
