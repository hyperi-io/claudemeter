// Every outside string that reaches the tooltip is hostile here. The tooltip allows HTML for its chart
// and trusts three command links, so none of these may come out as markup or as another command link.

import { describe, it, expect } from 'vitest';
const { composeTooltip } = require('../../src/tooltipComposer');
const { composeClaudeLabel } = require('../../src/claudeLabelComposer');
const { COMMANDS } = require('../../src/utils');

const PAYLOADS = [
    ['img onerror', '<img src=x onerror=alert(1)>'],
    ['script tag', '<script>alert(1)</script>'],
    ['svg onload', '<svg onload=alert(1)>'],
    ['html command link', '<a href="command:claudemeter.nopilot">x</a>'],
    ['markdown command link', '[click](command:claudemeter.nopilot)'],
    ['link terminator', '](command:claudemeter.nopilot)'],
    ['javascript link', '[x](javascript:alert(1))'],
    ['autolink', '<https://evil.example>'],
    ['code and emphasis', '`x` **y** ~~z~~'],
    ['backslash escape', '\\](command:claudemeter.nopilot)'],
];

const ALLOWED_COMMANDS = new Set([COMMANDS.NOPILOT, COMMANDS.NOPILOT_DISMISS]);
const REPO = 'https://github.com/hyperi-io/claudemeter';
const CHART = { uri: 'data:image/png;base64,AAAA', width: 240, lines: [{ key: 'session', label: 'Se', text: '60% at reset', colour: '#3987e5' }] };
// The only raw HTML the composer writes: the chart image and the colour span on each line label.
const OWN_HTML = [/<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" width="\d+" alt="[^"<>&]*">/g, /<span style="color:#[0-9a-f]{6};">/gi, /<\/span>/g];
const withoutOwnHtml = (text) => OWN_HTML.reduce((out, re) => out.replace(re, ''), text);

const config = { tokenLimitOverride: 0, use24HourTime: false, weeklyPrecisionThreshold: 75 };
const usage = (over = {}) => ({
    usagePercent: 10,
    resetsAt: '2026-10-28T05:00:00Z',
    usagePercentWeek: 20,
    resetsAtWeek: '2026-11-01T05:00:00Z',
    timestamp: new Date(),
    accountInfo: {},
    ...over,
});

// One entry per outside input. `build` puts the payload where that input enters the tooltip.
const INPUTS = [
    ['account name', (p) => ({ usageData: usage({ accountInfo: { name: p } }) })],
    ['account email', (p) => ({ usageData: usage({ accountInfo: { email: p } }) })],
    ['org name', (p) => ({ usageData: usage({ accountInfo: { orgName: p } }), credentialsInfo: { subscriptionType: 'max' } })],
    ['plan tier', (p) => ({ usageData: usage(), credentialsInfo: { subscriptionType: 'max', rateLimitTier: p } })],
    ['plan name', (p) => ({ usageData: usage(), credentialsInfo: { subscriptionType: p } })],
    ['scoped cap model name', (p) => ({ usageData: usage(), scopedWeekly: [{ label: p, percent: 5 }] })],
    ['scoped cap label override', (p) => ({
        usageData: usage(),
        scopedWeekly: [{ label: 'Fable', percent: 5 }],
        gaugeLabelOverrides: { Fable: { tooltip: p } },
    })],
    ['service status text', (p) => ({
        usageData: usage(),
        platformTooltipLines: composeClaudeLabel({ serviceStatus: { indicator: 'minor', description: p } }).tooltipLines,
    })],
    ['activity quip', (p) => ({ usageData: usage(), activityStats: { description: { quirky: p } } })],
    ['quip override', (p) => ({ usageData: usage(), activityQuipOverride: p })],
    ['happy hour icon', (p) => ({ usageData: usage(), happyHourState: { active: true, icon: p, endsAt: null } })],
    ['credits currency', (p) => ({ usageData: usage({ monthlyCredits: { used: 1, limit: 2, currency: p, percent: 50 } }) })],
    ['prepaid currency', (p) => ({ usageData: usage({ prepaidCredits: { balance: 5, currency: p } }) })],
    ['session percent', (p) => ({ usageData: usage({ usagePercent: p }) })],
    ['weekly percent', (p) => ({ usageData: usage({ usagePercentWeek: p }) })],
    ['chart line label and text', (p) => ({ usageData: usage(), usageChart: { ...CHART, lines: [{ key: 'session', label: p, text: p, colour: '#3987e5' }] } })],
    ['chart line colour', (p) => ({ usageData: usage(), usageChart: { ...CHART, lines: [{ key: 'session', label: 'Se', text: 'x', colour: p }] } })],
    ['agent plan, limit name and note', (p) => ({
        usageData: usage(),
        agents: [{ id: 'codex', name: 'Codex', shortLabel: 'Cx', usage: { plan: p, limits: [{ label: p, percent: 10, windowMinutes: 300, resetsAt: null }], notes: [p] } }],
    })],];

function compose(state) {
    return composeTooltip({
        config,
        repositoryUrl: REPO,
        marketplaceUrl: 'https://marketplace.visualstudio.com/items?itemName=HyperSec.claudemeter',
        extensionVersion: '1.0.0',
        showNopilotOffer: true,
        usageChart: CHART,
        ...state,
    });
}

describe('tooltip with hostile outside strings', () => {
    const cases = INPUTS.flatMap(([input, build]) => PAYLOADS.map(([name, payload]) => [input, name, payload, build]));

    it.each(cases)('%s: %s stays literal text', (_input, _name, payload, build) => {
        const out = compose(build(payload));

                const withoutChart = withoutOwnHtml(out);
        expect(withoutChart, 'raw angle bracket').not.toMatch(/(?<!\\)[<>]/);

        const targets = [...withoutChart.matchAll(/(?<!\\)\]\(([^)\s]*)/g)].map((m) => m[1]);
        for (const target of targets) {
            const command = target.match(/^command:([^?]+)/);
            if (command) expect(ALLOWED_COMMANDS.has(command[1]), `command link ${target}`).toBe(true);
            else expect(target.startsWith('https://') || target.startsWith('data:image/png;base64,'), `link target ${target}`).toBe(true);
        }
    });

    it('still renders the one chart image and the two trusted links around the payload', () => {
        const out = compose({ usageData: usage({ accountInfo: { name: PAYLOADS[0][1] } }) });
        expect(out.match(/(?<!\\)<img /g)).toHaveLength(1);
        expect(out).toContain(`command:${COMMANDS.NOPILOT}`);
        expect(out).toContain(`command:${COMMANDS.NOPILOT_DISMISS}`);
    });
});

describe('the rendered tooltip trusts only its own commands', () => {
    const vscode = require('vscode');
    const { createStatusBarItem, updateStatusBar } = require('../../src/statusBar');

    it.each(PAYLOADS)('%s in the account fields cannot add a command or markup', (_name, payload) => {
        vscode._resetConfigValues();
        const context = { subscriptions: [] };
        createStatusBarItem(context);
        const data = usage({ accountInfo: { name: payload, email: payload, orgName: payload } });
        const now = Date.now();
        const history = Array.from({ length: 4 }, (_, i) => ({
            ts: now - (3 - i) * 15 * 60_000,
            fiveHour: { pct: 10 + i, resetsAt: now + 3 * 3_600_000 },
            sevenDay: { pct: 20, resetsAt: now + 3 * 86_400_000 },
            scoped: {},
        }));
        updateStatusBar(null, data, null, { tokenUsage: { current: 5000, limit: 200_000 } }, { subscriptionType: 'max' }, history);
        const tooltip = context.subscriptions[3].tooltip;
        expect(tooltip.isTrusted.enabledCommands.sort()).toEqual([COMMANDS.NOPILOT, COMMANDS.NOPILOT_DISMISS].sort());
        expect(tooltip.supportHtml).toBe(true);
        const withoutChart = withoutOwnHtml(tooltip.value);
        expect(withoutChart).not.toMatch(/(?<!\\)[<>]/);
        const ids = [...withoutChart.matchAll(/(?<!\\)\]\(command:([^)?\s]+)/g)].map((m) => m[1]);
        expect(ids.every((id) => ALLOWED_COMMANDS.has(id))).toBe(true);
    });
});
