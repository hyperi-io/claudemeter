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
    });
});

describe('composeClaudeLabel — service status icons', () => {
    it('degraded (minor) shows $(pulse) with warning colour', () => {
        const r = composeClaudeLabel({ serviceStatus: { indicator: 'minor' } });
        expect(r.text).toContain('$(pulse)');
        expect(r.color).toBe('editorWarning.foreground');
    });

    it('partial outage (major) shows $(flame) with error colour', () => {
        const r = composeClaudeLabel({ serviceStatus: { indicator: 'major' } });
        expect(r.text).toContain('$(flame)');
        expect(r.color).toBe('errorForeground');
    });

    it('major outage (critical) shows $(cloud-offline)', () => {
        const r = composeClaudeLabel({ serviceStatus: { indicator: 'critical' } });
        expect(r.text).toContain('$(cloud-offline)');
        expect(r.color).toBe('errorForeground');
    });

    it('unknown shows $(question) with no colour', () => {
        const r = composeClaudeLabel({ serviceStatus: { indicator: 'unknown' } });
        expect(r.text).toContain('$(question)');
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
