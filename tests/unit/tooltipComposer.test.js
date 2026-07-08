// Tests for tooltipComposer.js - composes the full tooltip markdown
// body from state. Pure function, no vscode deps.
//
// Strategy: each section is a private helper, we test the composer's
// observable output for assorted state shapes, covering the main
// branches in the extracted logic.

import { describe, it, expect } from 'vitest';
const { composeTooltip } = require('../../src/tooltipComposer');

const baseConfig = {
    tokenLimitOverride: 0,
    use24HourTime: false,
    weeklyPrecisionThreshold: 75,
};

describe('composeTooltip - empty state', () => {
    it('returns a string even with no data', () => {
        const out = composeTooltip({ config: baseConfig });
        expect(typeof out).toBe('string');
    });
});

describe('composeTooltip - account identity', () => {
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

describe('composeTooltip - plan + context', () => {
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

describe('composeTooltip - session block', () => {
    it('renders Session with percent and reset time', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: {
                usagePercent: 42,
                resetTime: '2h 15m',
                timestamp: new Date(),
            },
        });
        expect(out).toMatch(/\*\*Session - 42%\*\*/);
        expect(out).toMatch(/Resets/);
    });

    it('includes Tokens line when sessionData present', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: { usagePercent: 10, resetTime: '1h', timestamp: new Date() },
            sessionData: { tokenUsage: { current: 50000, limit: 1000000 } },
        });
        expect(out).toMatch(/Tokens /);
    });

    it('shows override line when tokenLimitOverride > 0', () => {
        const out = composeTooltip({
            config: { ...baseConfig, tokenLimitOverride: 500000 },
            usageData: { usagePercent: 10, resetTime: '1h', timestamp: new Date() },
        });
        expect(out).toMatch(/Context window override/);
    });
});

describe('composeTooltip - weekly block', () => {
    it('renders Weekly with percent', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: {
                usagePercent: 10, usagePercentWeek: 25,
                resetTime: '1h', resetTimeWeek: '3d 12h',
                timestamp: new Date(),
            },
        });
        expect(out).toMatch(/\*\*Weekly - 25%\*\*/);
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
        expect(out).toMatch(/Sonnet 30%/);
        expect(out).toMatch(/Opus 15%/);
    });
});

describe('composeTooltip - credits blocks', () => {
    it('renders Extra Usage when monthlyCredits present', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: {
                monthlyCredits: { used: 33.14, limit: 100, currency: 'AUD', percent: 33 },
                timestamp: new Date(),
            },
        });
        expect(out).toMatch(/\*\*Extra Usage\*\*/);
        expect(out).toMatch(/Used \$/);
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
        expect(out).toMatch(/Balance \$/);
    });
});

describe('composeTooltip - activity quip', () => {
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

    it('wraps a long quip so no single line drives the tooltip width', () => {
        const long = 'The truth is out there but the tokens are right here and there are rather a lot of them today';
        const out = composeTooltip({
            config: baseConfig,
            activityStats: { description: { quirky: long } },
        });
        // italic quip lines are single-asterisk (bold headers are double)
        const quipLines = out.split('  \n').filter((l) => l.startsWith('*') && !l.startsWith('**'));
        expect(quipLines.length).toBeGreaterThan(1);
        for (const line of quipLines) {
            expect(line.replace(/^\*|\*$/g, '').length).toBeLessThanOrEqual(42);
        }
    });
});

describe('composeTooltip - service status lines', () => {
    it('includes platform lines when provided', () => {
        const out = composeTooltip({
            config: baseConfig,
            platformTooltipLines: ['$(pulse) Service degraded — API delays'],
        });
        expect(out).toMatch(/Service degraded/);
    });
});

describe('composeTooltip - footer', () => {
    it('renders whatever extensionVersion is passed in the footer', () => {
        // Synthetic placeholder - the real version is read from package.json by
        // the caller and passed in; composeTooltip never hardcodes a version.
        const out = composeTooltip({
            config: baseConfig,
            extensionVersion: '0.0.0-test',
        });
        expect(out).toMatch(/Claudemeter v0\.0\.0-test/);
    });

    it('links the footer version to the repo when a URL is provided', () => {
        const out = composeTooltip({
            config: baseConfig,
            extensionVersion: '0.0.0-test',
            repositoryUrl: 'https://github.com/hyperi-io/claudemeter',
        });
        expect(out).toMatch(/\[Claudemeter v0\.0\.0-test\]\(https:\/\/github\.com\/hyperi-io\/claudemeter\)/);
    });

    it('shows a star/rate nudge above the version when URLs are provided', () => {
        const out = composeTooltip({
            config: baseConfig,
            extensionVersion: '0.0.0-test',
            repositoryUrl: 'https://github.com/hyperi-io/claudemeter',
            marketplaceUrl: 'https://marketplace.visualstudio.com/items?itemName=hypersec.claudemeter&ssr=false#review-details',
        });
        expect(out).toMatch(/Is this useful for you\?/);
        expect(out).toMatch(/\[star\]\(https:\/\/github\.com\/hyperi-io\/claudemeter\)/);
        expect(out).toMatch(/\[rate\]\(https:\/\/marketplace\.visualstudio\.com/);
        // nudge sits ABOVE the version line
        expect(out.indexOf('Is this useful for you?')).toBeLessThan(out.indexOf('Claudemeter v0.0.0-test'));
    });

    it('omits the nudge entirely when no repo/marketplace URL is known', () => {
        const out = composeTooltip({ config: baseConfig, extensionVersion: '0.0.0-test' });
        expect(out).not.toMatch(/Is this useful for you\?/);
    });

    it('does not include the removed resync-account link', () => {
        // The browserless OAuth switch deleted claudemeter.resyncAccount; the
        // footer must not render a dead command link. Login is offered via the
        // status-bar click / the not-logged-in error tooltip instead.
        const out = composeTooltip({ config: baseConfig });
        expect(out).not.toMatch(/resync/i);
        expect(out).not.toMatch(/command:claudemeter\.resyncAccount/);
    });
});

describe('composeTooltip - section error containment', () => {
    it('a broken section does not kill other sections', () => {
        // Pass malformed data into one section; others should still render.
        const out = composeTooltip({
            config: baseConfig,
            usageData: {
                // bad accountInfo - not an object, triggers error in identity section
                accountInfo: 'not an object',
                usagePercent: 42,
                resetTime: '1h',
                timestamp: new Date(),
            },
            extensionVersion: '2.3.4',
        });
        // Session and footer should still render
        expect(out).toMatch(/\*\*Session - 42%\*\*/);
        expect(out).toMatch(/Claudemeter v2\.3\.4/);
    });
});

describe('composeTooltip - Session / Current context / Weekly section split (post-2026-05-08)', () => {
    const baseConfig = {
        tokenLimitOverride: 0,
        use24HourTime: false,
        weeklyPrecisionThreshold: 75,
    };

    it('emits three distinct headings in order: Current context -> Session -> Weekly', () => {
        const out = composeTooltip({
            usageData: {
                usagePercent: 50,
                resetTime: '2h 30m',
                usagePercentWeek: 30,
                resetTimeWeek: '3d 4h',
            },
            sessionData: {
                tokenUsage: { current: 400_000, limit: 1_000_000, limitConfidence: 'authoritative' },
            },
            config: baseConfig,
        });

        const sessionIdx = out.indexOf('**Session - 50%**');
        const contextIdx = out.indexOf('**Current context - 40%**');
        const weeklyIdx  = out.indexOf('**Weekly - 30%**');

        expect(sessionIdx).toBeGreaterThan(-1);
        expect(contextIdx).toBeGreaterThan(-1);
        expect(weeklyIdx).toBeGreaterThan(-1);
        expect(contextIdx).toBeLessThan(sessionIdx);
        expect(sessionIdx).toBeLessThan(weeklyIdx);
    });

    it('Tokens row appears under Current context, NOT under Session', () => {
        const out = composeTooltip({
            usageData: { usagePercent: 50, resetTime: '2h' },
            sessionData: {
                tokenUsage: { current: 400_000, limit: 1_000_000, limitConfidence: 'authoritative' },
            },
            config: baseConfig,
        });
        const sessionIdx = out.indexOf('**Session');
        const contextIdx = out.indexOf('**Current context');
        const tokensIdx  = out.indexOf('Tokens ');
        // Tokens sits inside the Current context block: after its heading and
        // before the Session block that now follows it.
        expect(tokensIdx).toBeGreaterThan(contextIdx);
        expect(tokensIdx).toBeLessThan(sessionIdx);
    });
});

describe('composeTooltip - plain rendering (regression guards)', () => {
    // VS Code's MarkdownString tooltip context strips both raw
    // style="color:#HEX" (microsoft/vscode#142457) AND
    // `var(--vscode-...)` CSS variables - CSS vars only resolve in
    // webviews. These tests guard against any future attempt to
    // reintroduce per-row tier colour in the tooltip, which would
    // visibly render as plain text and leave styling tags in the
    // markdown body.

    const baseConfig = { tokenLimitOverride: 0, use24HourTime: false, weeklyPrecisionThreshold: 75 };

    it('emits no <span> tag and no style attribute in any row', () => {
        const out = composeTooltip({
            usageData: { usagePercent: 30, resetTime: '2h' },
            sessionData: {
                tokenUsage: { current: 300_000, limit: 1_000_000, limitConfidence: 'authoritative' },
            },
            tokensInfo: { recommendation: 'Recall starts to drift in long-context tasks.' },
            config: baseConfig,
        });
        expect(out).not.toContain('<span');
        expect(out).not.toContain('style=');
    });

    it('emits no var(--vscode-...) CSS variable references', () => {
        const out = composeTooltip({
            usageData: {
                usagePercent: 85, resetTime: '2h',
                usagePercentWeek: 95, resetTimeWeek: '3d',
            },
            sessionData: {
                tokenUsage: { current: 800_000, limit: 1_000_000, limitConfidence: 'authoritative' },
            },
            config: baseConfig,
        });
        expect(out).not.toMatch(/var\(--vscode-/);
        expect(out).not.toContain('claudemeter-rotLight');
        expect(out).not.toContain('claudemeter-rotDeep');
        expect(out).not.toContain('claudemeter-outageRed');
        expect(out).not.toContain('charts-yellow');
    });

    it('emits no raw #HEX colours in style position', () => {
        const out = composeTooltip({
            usageData: {
                usagePercent: 85, resetTime: '2h',
                usagePercentWeek: 95, resetTimeWeek: '3d',
            },
            sessionData: {
                tokenUsage: { current: 800_000, limit: 1_000_000, limitConfidence: 'authoritative' },
            },
            config: baseConfig,
        });
        expect(out).not.toMatch(/style="color:\s*#[0-9a-fA-F]{3,6}/);
    });

    it('emits no ● bullet prefix on the Tokens row', () => {
        const out = composeTooltip({
            usageData: { usagePercent: 30, resetTime: '2h' },
            sessionData: {
                tokenUsage: { current: 300_000, limit: 1_000_000, limitConfidence: 'authoritative' },
            },
            config: baseConfig,
        });
        expect(out).not.toContain('●');
    });

    it('still includes the recommendation when tokensInfo.recommendation is set', () => {
        const out = composeTooltip({
            usageData: { usagePercent: 30, resetTime: '2h' },
            sessionData: {
                tokenUsage: { current: 300_000, limit: 1_000_000, limitConfidence: 'authoritative' },
            },
            tokensInfo: { recommendation: 'Recall starts to drift in long-context tasks.' },
            config: baseConfig,
        });
        expect(out).toContain('Recall starts to drift');
    });

    it('section split preserved with plain bold headers (no wrapping)', () => {
        const out = composeTooltip({
            usageData: { usagePercent: 30, resetTime: '2h', usagePercentWeek: 10, resetTimeWeek: '3d' },
            sessionData: {
                tokenUsage: { current: 300_000, limit: 1_000_000, limitConfidence: 'authoritative' },
            },
            config: baseConfig,
        });
        expect(out).toContain('**Session - 30%**');
        expect(out).toContain('**Current context - 30%**');
        expect(out).toContain('**Weekly - 10%**');
        // Headers stand alone on their line - never embedded inside an HTML tag
        expect(out).not.toMatch(/<[^>]*>\*\*(Session|Weekly|Current context)/);
    });
});
