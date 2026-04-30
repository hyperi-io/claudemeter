// Tests for tooltipComposer.js — composes the full tooltip markdown
// body from state. Pure function; no vscode deps.
//
// Strategy: each section is a private helper; we test the composer's
// observable output for assorted state shapes, covering the main
// branches in the extracted logic.

import { describe, it, expect } from 'vitest';
const { composeTooltip } = require('../../src/tooltipComposer');

const baseConfig = {
    tokenLimitOverride: 0,
    use24HourTime: false,
    weeklyPrecisionThreshold: 75,
};

describe('composeTooltip — empty state', () => {
    it('returns a string even with no data', () => {
        const out = composeTooltip({ config: baseConfig });
        expect(typeof out).toBe('string');
    });
});

describe('composeTooltip — account identity', () => {
    it('renders name and email when both present', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: {
                accountInfo: { name: 'Derek', email: 'derek@example.com' },
                timestamp: new Date(),
            },
            credentialsInfo: { subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' },
        });
        expect(out).toContain('**Derek** (derek@example.com)');
    });

    it('strips trailing "\'s Organization" from name', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: {
                accountInfo: { name: "Derek's Organization", email: 'derek@example.com' },
                timestamp: new Date(),
            },
        });
        expect(out).toContain('**Derek**');
        expect(out).not.toContain("'s Organization");
    });

    it('escapes markdown special chars in name', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: {
                accountInfo: { name: '*Derek*', email: 'd@e.com' },
                timestamp: new Date(),
            },
        });
        expect(out).toContain('\\*Derek\\*');
    });

    it('email alone when no name', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: {
                accountInfo: { email: 'd@e.com' },
                timestamp: new Date(),
            },
        });
        expect(out).toContain('d@e.com');
    });
});

describe('composeTooltip — plan + context', () => {
    it('shows plan with Personal suffix when no orgType', () => {
        const out = composeTooltip({
            config: baseConfig,
            credentialsInfo: { subscriptionType: 'max', rateLimitTier: 'default_claude_max_5x' },
        });
        expect(out).toMatch(/Max \(Personal\)/);
    });

    it('shows plan with orgType when provided', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: { accountInfo: { orgType: 'Enterprise' }, timestamp: new Date() },
            credentialsInfo: { subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' },
        });
        expect(out).toMatch(/Max \(Enterprise\)/);
    });

    it('shows Context: line when sessionData has tokenUsage', () => {
        const out = composeTooltip({
            config: baseConfig,
            sessionData: {
                tokenUsage: { current: 100000, limit: 1000000, limitConfidence: 'authoritative' },
            },
        });
        expect(out).toMatch(/Context:/);
    });

    it('marks inferred context', () => {
        const out = composeTooltip({
            config: baseConfig,
            sessionData: {
                tokenUsage: { current: 100000, limit: 200000, limitConfidence: 'inferred' },
            },
        });
        expect(out).toMatch(/inferred/);
    });
});

describe('composeTooltip — session block', () => {
    it('renders Session with percent and reset time', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: {
                usagePercent: 42,
                resetTime: '2h 15m',
                timestamp: new Date(),
            },
        });
        expect(out).toMatch(/\*\*Session 42%\*\*/);
        expect(out).toMatch(/Resets/);
    });

    it('includes Tokens line when sessionData present', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: { usagePercent: 10, resetTime: '1h', timestamp: new Date() },
            sessionData: { tokenUsage: { current: 50000, limit: 1000000 } },
        });
        expect(out).toMatch(/Tokens:/);
    });

    it('shows override line when tokenLimitOverride > 0', () => {
        const out = composeTooltip({
            config: { ...baseConfig, tokenLimitOverride: 500000 },
            usageData: { usagePercent: 10, resetTime: '1h', timestamp: new Date() },
        });
        expect(out).toMatch(/Context window override/);
    });
});

describe('composeTooltip — weekly block', () => {
    it('renders Weekly with percent', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: {
                usagePercent: 10, usagePercentWeek: 25,
                resetTime: '1h', resetTimeWeek: '3d 12h',
                timestamp: new Date(),
            },
        });
        expect(out).toMatch(/\*\*Weekly 25%\*\*/);
    });

    it('includes Sonnet and Opus sub-lines when provided', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: {
                usagePercent: 10, usagePercentWeek: 25,
                usagePercentSonnet: 30, usagePercentOpus: 15,
                resetTime: '1h', resetTimeWeek: '3d 12h',
                timestamp: new Date(),
            },
        });
        expect(out).toMatch(/Sonnet: 30%/);
        expect(out).toMatch(/Opus: 15%/);
    });
});

describe('composeTooltip — credits blocks', () => {
    it('renders Extra Usage when monthlyCredits present', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: {
                monthlyCredits: { used: 33.14, limit: 100, currency: 'AUD', percent: 33 },
                timestamp: new Date(),
            },
        });
        expect(out).toMatch(/\*\*Extra Usage\*\*/);
        expect(out).toMatch(/Used:/);
    });

    it('renders Credits block when only prepaidCredits present', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: {
                prepaidCredits: { balance: 25, currency: 'USD' },
                timestamp: new Date(),
            },
        });
        expect(out).toMatch(/\*\*Credits\*\*/);
    });

    it('appends prepaid balance inside Extra Usage when both present', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: {
                monthlyCredits: { used: 33, limit: 100, currency: 'AUD', percent: 33 },
                prepaidCredits: { balance: 50, currency: 'AUD' },
                timestamp: new Date(),
            },
        });
        expect(out).toMatch(/Balance:/);
    });
});

describe('composeTooltip — activity quip', () => {
    it('renders quip in italics when provided', () => {
        const out = composeTooltip({
            config: baseConfig,
            activityStats: { description: { quirky: 'Tokens: bodacious!' } },
        });
        expect(out).toMatch(/\*Tokens: bodacious!\*/);
    });

    it('activityQuipOverride replaces the quirky message entirely', () => {
        const out = composeTooltip({
            config: baseConfig,
            activityStats: { description: { quirky: 'Tokens: bodacious!' } },
            activityQuipOverride: "He's dead, Jim.",
        });
        expect(out).toMatch(/\*He's dead, Jim\.\*/);
        expect(out).not.toMatch(/Tokens: bodacious!/);
    });
});

describe('composeTooltip — service status lines', () => {
    it('includes platform lines when provided', () => {
        const out = composeTooltip({
            config: baseConfig,
            platformTooltipLines: ['$(pulse) Service degraded — API delays'],
        });
        expect(out).toMatch(/Service degraded/);
    });
});

describe('composeTooltip — footer', () => {
    it('includes version when provided', () => {
        const out = composeTooltip({
            config: baseConfig,
            extensionVersion: '2.3.4',
        });
        expect(out).toMatch(/Claudemeter v2\.3\.4/);
    });

    it('always includes the resync link', () => {
        const out = composeTooltip({ config: baseConfig });
        expect(out).toMatch(/Click to resync account/);
    });
});

describe('composeTooltip — section error containment', () => {
    it('a broken section does not kill other sections', () => {
        // Pass malformed data into one section; others should still render.
        const out = composeTooltip({
            config: baseConfig,
            usageData: {
                // bad accountInfo — not an object; triggers error in identity section
                accountInfo: 'not an object',
                usagePercent: 42,
                resetTime: '1h',
                timestamp: new Date(),
            },
            extensionVersion: '2.3.4',
        });
        // Session and footer should still render
        expect(out).toMatch(/\*\*Session 42%\*\*/);
        expect(out).toMatch(/Claudemeter v2\.3\.4/);
    });
});
