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

// The tooltip is a trusted MarkdownString, so a link to a command: URI in any
// outside string would execute on click.
describe('composeTooltip - outside strings cannot inject a command link', () => {
    const HOSTILE = 'Evil [x](command:workbench.action.terminal.sendSequence?%7B%7D) <command:foo>';
    const injected = (out) => out.includes('[x](command:') || out.includes('<command:foo>');

    it.each([
        ['account name', { usageData: { accountInfo: { name: HOSTILE } } }],
        ['email', { usageData: { accountInfo: { email: HOSTILE } } }],
        ['name and email', { usageData: { accountInfo: { name: 'Derek', email: HOSTILE } } }],
        ['organisation name', {
            usageData: { accountInfo: { orgName: HOSTILE } },
            credentialsInfo: { subscriptionType: 'max' },
        }],
        ['organisation type', {
            usageData: { accountInfo: { organizationType: HOSTILE } },
            credentialsInfo: { subscriptionType: 'max' },
        }],
        ['rate-limit tier', { credentialsInfo: { subscriptionType: 'max', rateLimitTier: HOSTILE } }],
        ['subscription type', { credentialsInfo: { subscriptionType: HOSTILE } }],
        ['scoped cap label', {
            usageData: { usagePercentWeek: 1, scopedWeekly: [{ label: HOSTILE, percent: 5 }] },
        }],
        ['currency', {
            usageData: {
                monthlyCredits: { used: 1, limit: 2, currency: HOSTILE, percent: 50 },
                prepaidCredits: { balance: 1, currency: HOSTILE },
            },
        }],
        ['prepaid currency', { usageData: { prepaidCredits: { balance: 1, currency: HOSTILE } } }],
        ['custom happy-hour icon', { happyHourState: { active: true, icon: HOSTILE, endsAt: null } }],
    ])('%s', (_name, state) => {
        expect(injected(composeTooltip({ config: baseConfig, ...state }))).toBe(false);
    });

    it('keeps a codicon happy-hour icon renderable', () => {
        const out = composeTooltip({
            config: baseConfig,
            happyHourState: { active: true, icon: '$(sparkle)', endsAt: null },
        });
        expect(out).toContain('$(sparkle) Happy hour');
    });

    it('states when happy hour ends in the long form, honouring 24-hour time', () => {
        const endsAt = new Date('2026-10-16T21:05:00Z');
        const out = composeTooltip({
            config: { ...baseConfig, use24HourTime: true },
            happyHourState: { active: true, icon: '$(sparkle)', endsAt },
        });
        const expected = endsAt.toLocaleString(undefined, {
            weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: false,
        });
        expect(out).toContain(`$(sparkle) Happy hour — off-peak, ends ${expected}`);
    });
});

describe('composeTooltip - plan + context', () => {
    it('shows plan with Personal suffix when the plan token names no shared org', () => {
        const out = composeTooltip({
            config: baseConfig,
            credentialsInfo: { subscriptionType: 'max', rateLimitTier: 'default_claude_max_5x' },
        });
        expect(out).toMatch(/Max \(Personal\)/);
    });

    it.each([
        ['claude_enterprise', 'Enterprise'],
        ['claude_team', 'Team'],
    ])('labels the %s plan token as %s', (token, label) => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: { accountInfo: { organizationType: token }, timestamp: new Date() },
            credentialsInfo: { subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' },
        });
        expect(out).toMatch(new RegExp(`Max \\(${label}\\)`));
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
                timestamp: new Date(),
            },
        });
        expect(out).toMatch(/\*\*Session - 42%\*\*/);
        expect(out).toMatch(/Resets/);
    });

    it('renders the reset from the stamp the payload carried', () => {
        const resetsAt = '2026-10-16T02:30:00Z';
        const out = composeTooltip({
            config: baseConfig,
            usageData: { usagePercent: 42, resetsAt, timestamp: new Date() },
        });
        const expected = new Date(resetsAt).toLocaleString(undefined, {
            weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true,
        });
        expect(out).toContain(`Resets ${expected}`);
    });

    it('shows "-" rather than the current time when the stamp is missing', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: { usagePercent: 42, resetsAt: null, timestamp: new Date() },
        });
        expect(out).toContain('Resets -');
    });

    it('includes Tokens line when sessionData present', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: { usagePercent: 10, timestamp: new Date() },
            sessionData: { tokenUsage: { current: 50000, limit: 1000000 } },
        });
        expect(out).toMatch(/Tokens /);
    });

    it('shows override line when tokenLimitOverride > 0', () => {
        const out = composeTooltip({
            config: { ...baseConfig, tokenLimitOverride: 500000 },
            usageData: { usagePercent: 10, timestamp: new Date() },
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
                timestamp: new Date(),
            },
        });
        expect(out).toMatch(/\*\*Weekly - 25%\*\*/);
    });

    // Every scoped cap the payload reports gets a line, whatever the model is
    // called - the tooltip names no model of its own.
    it('includes a sub-line per scoped weekly cap', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: {
                usagePercent: 10, usagePercentWeek: 25,
                scopedWeekly: [
                    { label: 'Fable', percent: 72 },
                    { label: 'Something New', percent: 3 },
                ],
                timestamp: new Date(),
            },
        });
        expect(out).toMatch(/Fable 72%/);
        expect(out).toMatch(/Something New 3%/);
    });

    it('omits scoped sub-lines when the payload has none', () => {
        const out = composeTooltip({
            config: baseConfig,
            usageData: {
                usagePercent: 10, usagePercentWeek: 25,
                scopedWeekly: [],
                timestamp: new Date(),
            },
        });
        expect(out).toMatch(/\*\*Weekly - 25%\*\*/);
        expect(out).not.toMatch(/%\n.*%/);
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

    it('lays out each credits shape line by line', () => {
        const compose = (usageData) => composeTooltip({ config: baseConfig, usageData });
        expect(compose({ prepaidCredits: { balance: 25, currency: 'USD' } }))
            .toContain('**Credits**  \nBalance $25 USD');
        expect(compose({
            monthlyCredits: { used: 33, limit: 100, currency: 'AUD', percent: 33 },
            prepaidCredits: { balance: 50, currency: 'AUD' },
        })).toContain('**Extra Usage**  \nUsed $33 / $100 AUD (33%)  \nBalance $50 AUD');
        expect(compose({ usagePercent: 1 })).not.toMatch(/Credits|Extra Usage|Balance/);
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
                timestamp: new Date(),
            },
            extensionVersion: '2.3.4',
        });
        // Session and footer should still render
        expect(out).toMatch(/\*\*Session - 42%\*\*/);
        expect(out).toMatch(/Claudemeter v2\.3\.4/);
    });
});

describe('composeTooltip - Session / Current context / Weekly section split', () => {
    const baseConfig = {
        tokenLimitOverride: 0,
        use24HourTime: false,
        weeklyPrecisionThreshold: 75,
    };

    it('emits three distinct headings in order: Current context -> Session -> Weekly', () => {
        const out = composeTooltip({
            usageData: {
                usagePercent: 50,
                usagePercentWeek: 30,
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

    it('reads the context figures from tokensInfo, which carries a simulated override', () => {
        const out = composeTooltip({
            usageData: { usagePercent: 50 },
            sessionData: { tokenUsage: { current: 15_300, limit: 1_000_000 } },
            tokensInfo: { current: 700_000, limit: 1_000_000, recommendation: null },
            config: baseConfig,
        });
        expect(out).toContain('**Current context - 70%**');
        expect(out).toContain('Tokens 700.0K / 1.0M');
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
                usagePercent: 85,
                usagePercentWeek: 95,
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
                usagePercent: 85,
                usagePercentWeek: 95,
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
            usageData: { usagePercent: 30, usagePercentWeek: 10 },
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

describe('composeTooltip - Nopilot offer', () => {
    const withOffer = (showNopilotOffer) => composeTooltip({
        config: baseConfig,
        usageData: { timestamp: new Date('2026-08-13T02:30:00Z') },
        showNopilotOffer,
    });

    it('is absent unless the caller says it is due', () => {
        expect(withOffer(false)).not.toContain('Nopilot');
        expect(composeTooltip({ config: baseConfig })).not.toContain('Nopilot');
    });

    it('renders both links as command URIs', () => {
        const out = withOffer(true);
        expect(out).toContain('[Nopilot - disable copilot upsell and telemetry](command:claudemeter.nopilot)');
        expect(out).toContain('[(hide)](command:claudemeter.nopilot.dismiss)');
    });

    it('sits on the line directly above Updated', () => {
        const lines = withOffer(true).split('\n').filter((l) => l.trim().length > 0);
        const offer = lines.findIndex((l) => l.includes('Nopilot'));
        const updated = lines.findIndex((l) => l.startsWith('Updated'));
        expect(offer).toBeGreaterThanOrEqual(0);
        expect(updated).toBe(offer + 1);
    });
});

describe('composeTooltip - usage chart', () => {
    const chart = (over = {}) => ({
        uri: 'data:image/png;base64,AAAA',
        width: 240,
        lines: [
            { key: 'session', label: 'Se', text: 'out in 1h20, 50m blocked', colour: '#3987e5' },
            { key: 'weekly', label: 'Wk', text: '60% at reset', colour: '#d95926' },
        ],
        ...over,
    });
    const usageData = { usagePercent: 10, resetsAt: '2026-10-28T05:00:00Z', usagePercentWeek: 20, resetsAtWeek: '2026-11-01T05:00:00Z', timestamp: new Date() };
    const compose = (usageChart) => composeTooltip({ config: baseConfig, usageData, usageChart });

    it('puts the chart after the weekly block and before credits', () => {
        const out = compose(chart());
        expect(out.indexOf('**Weekly - 20%**')).toBeLessThan(out.indexOf('<img'));
        expect(out.indexOf('<img')).toBeLessThan(out.indexOf('Updated'));
    });

    it('sizes the image by width and gives it the lines as plain alt text', () => {
        const out = compose(chart());
        expect(out).toContain('<img src="data:image/png;base64,AAAA" width="240" alt="Se out in 1h20, 50m blocked; Wk 60% at reset">');
    });

    it('prints one line per gauge under the image, the label in its line colour', () => {
        const lines = compose(chart()).split('  \n');
        const at = lines.findIndex((l) => l.startsWith('<img'));
        // The blank line ends the image's HTML paragraph, or the lines would run on beside it.
        expect(lines[at + 1]).toBe('');
        expect(lines.slice(at + 2, at + 4)).toEqual([
            '<span style="color:#3987e5;">Se</span> out in 1h20, 50m blocked',
            '<span style="color:#d95926;">Wk</span> 60% at reset',
        ]);
    });

    it.each([
        ['a colour that is not a plain hex', 'red;background:url(x)'],
        ['no colour', undefined],
    ])('prints the label uncoloured for %s', (_name, colour) => {
        const out = compose(chart({ lines: [{ key: 'session', label: 'Se', text: '60% at reset', colour }] }));
        expect(out).toContain('  \nSe 60% at reset');
        expect(out).not.toContain('<span');
    });

    it('has no command link of its own', () => {
        const lines = compose(chart()).split('  \n');
        const at = lines.findIndex((l) => l.startsWith('<img'));
        expect(lines[at - 1]).toBe('');
        expect(lines.slice(at, at + 4).join('\n')).not.toContain('command:');
    });

    it('keeps quotes and angle brackets out of the alt attribute', () => {
        const out = compose(chart({ sentences: ['Se: a "quoted" <b>bold</b> & more'] }));
        expect(out.match(/<img[^\n]*>/)[0]).toMatch(/^<img src="[^"]*" width="240" alt="[^"<>&]*">$/);
    });

    it('adds nothing without a chart', () => {
        expect(compose(null)).not.toContain('<img');
    });
});

describe('composeTooltip - supplementary agents', () => {
    const usageData = { usagePercent: 10, resetsAt: '2026-10-28T05:00:00Z', usagePercentWeek: 20, resetsAtWeek: '2026-11-01T05:00:00Z', timestamp: new Date() };
    const codex = (limits, extra = {}) => ({ id: 'codex', name: 'Codex', shortLabel: 'Cx', usage: { plan: 'pro', limits, notes: [], ...extra } });
    const lines = (agents) => composeTooltip({ config: baseConfig, usageData, agents }).split('  \n');

    it('heads the block with the fullest limit and lists every limit with its reset', () => {
        const out = lines([codex([
            { label: '5h', percent: 42.4, windowMinutes: 300, resetsAt: Date.parse('2026-10-28T04:00:00Z') },
            { label: '7d', percent: 12.5, windowMinutes: 10080, resetsAt: null },
        ], { notes: ['1 free limit reset available'] })]);
        const at = out.indexOf('**Codex - 42%**');
        expect(at).toBeGreaterThan(out.findIndex((l) => l.startsWith('**Weekly')));
        expect(out[at + 1]).toBe('Plan pro');
        expect(out[at + 2]).toMatch(/^5h 42%, resets /);
        expect(out.slice(at + 2).join(' ')).toContain('7d 13%');
        expect(out).toContain('1 free limit reset available');
    });

    it.each([
        ['no agents', []],
        ['an agent with no limits', [codex([])]],
        ['agents left out', undefined],
    ])('adds nothing for %s', (_name, agents) => {
        expect(composeTooltip({ config: baseConfig, usageData, agents })).not.toContain('Codex');
    });
});
