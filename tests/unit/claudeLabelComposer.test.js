// Tests for claudeLabelComposer.js — composes the leftmost "Claude"
// status-bar panel from platform-wide state (service status, happy
// hour, refresh spinner). Pure function.

import { describe, it, expect } from 'vitest';
const {
    composeClaudeLabel,
    HAPPY_HOUR_ICONS,
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

describe('composeClaudeLabel — happy hour only', () => {
    it('appends beer icon when happyHourActive', () => {
        const r = composeClaudeLabel({ happyHourActive: true, happyHourIcon: '🍺' });
        expect(r.text).toBe('Claude 🍺');
        expect(r.tooltipLines.length).toBe(1);
        expect(r.tooltipLines[0]).toMatch(/🍺/);
        expect(r.tooltipLines[0]).toMatch(/Happy hour/);
    });

    it('renders custom icon verbatim', () => {
        const r = composeClaudeLabel({ happyHourActive: true, happyHourIcon: '🎉' });
        expect(r.text).toBe('Claude 🎉');
    });

    it('silent when happyHourIcon is falsy', () => {
        const r = composeClaudeLabel({ happyHourActive: true, happyHourIcon: '' });
        expect(r.text).toBe('Claude');
    });

    it('silent when happyHourIcon is null', () => {
        const r = composeClaudeLabel({ happyHourActive: true, happyHourIcon: null });
        expect(r.text).toBe('Claude');
    });

    it('includes endsAt in tooltip when provided', () => {
        const r = composeClaudeLabel({
            happyHourActive: true,
            happyHourIcon: '🍺',
            happyHourEndsAt: new Date('2026-04-15T12:00:00Z'),
        });
        expect(r.tooltipLines[0]).toMatch(/ends/);
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
    it('service + happy hour: service first, happy hour second', () => {
        const r = composeClaudeLabel({
            serviceStatus: { indicator: 'minor' },
            happyHourActive: true,
            happyHourIcon: '🍺',
        });
        expect(r.text).toBe('Claude $(pulse) 🍺');
    });

    it('refreshing appended as $(loading) at the end', () => {
        const r = composeClaudeLabel({
            serviceStatus: { indicator: 'minor' },
            happyHourActive: true,
            happyHourIcon: '🍺',
            isRefreshing: true,
        });
        expect(r.text).toBe('Claude $(pulse) 🍺 $(loading)');
    });

    it('refreshing alone just appends the spinner', () => {
        const r = composeClaudeLabel({ isRefreshing: true });
        expect(r.text).toBe('Claude $(loading)');
    });

    it('outage + happy hour renders both icons with error colour (outage wins)', () => {
        const r = composeClaudeLabel({
            serviceStatus: { indicator: 'critical' },
            happyHourActive: true,
            happyHourIcon: '🍺',
        });
        expect(r.text).toBe('Claude $(cloud-offline) 🍺');
        expect(r.color).toBe('errorForeground');
    });
});

describe('composeClaudeLabel — tooltip section order', () => {
    it('service line first, then happy hour', () => {
        const r = composeClaudeLabel({
            serviceStatus: { indicator: 'minor', description: 'API delays' },
            happyHourActive: true,
            happyHourIcon: '🍺',
            happyHourEndsAt: new Date('2026-04-15T12:00:00Z'),
        });
        expect(r.tooltipLines.length).toBe(2);
        expect(r.tooltipLines[0]).toMatch(/Service degraded/);
        expect(r.tooltipLines[1]).toMatch(/Happy hour/);
    });
});

describe('HAPPY_HOUR_ICONS', () => {
    it('exports the enum-name → emoji table', () => {
        expect(HAPPY_HOUR_ICONS.beer).toBe('🍺');
        expect(HAPPY_HOUR_ICONS.cocktail).toBe('🍹');
        expect(HAPPY_HOUR_ICONS.wine).toBe('🍷');
        expect(HAPPY_HOUR_ICONS.champagne).toBe('🥂');
        expect(HAPPY_HOUR_ICONS.martini).toBe('🍸');
        expect(HAPPY_HOUR_ICONS.coffee).toBe('☕');
        expect(HAPPY_HOUR_ICONS.moon).toBe('🌙');
        expect(HAPPY_HOUR_ICONS.sparkles).toBe('✨');
        expect(HAPPY_HOUR_ICONS.palm).toBe('🌴');
        expect(HAPPY_HOUR_ICONS.party).toBe('🎉');
    });

    it('is frozen', () => {
        expect(Object.isFrozen(HAPPY_HOUR_ICONS)).toBe(true);
    });
});
