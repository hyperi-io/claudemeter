// Tests for updateStatusBar driven through the real renderer: what each panel
// shows, whether it is visible, and what its tooltip lets a click do.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const vscode = require('vscode');
const { createStatusBarItem, updateStatusBar, stopSpinner } = require('../../src/statusBar');
const { processApiResponse, upgradeCachedUsage } = require('../../src/apiSchema');
const { COMMANDS } = require('../../src/utils');

const PANEL_ORDER = ['label', 'spinner', 'happyHour', 'session', 'weekly', 'scoped0', 'scoped1', 'credits', 'tokens', 'compact'];

function freshPanels(settings = {}) {
    vscode._resetConfigValues();
    vscode._setConfigValues(settings);
    const context = { subscriptions: [] };
    createStatusBarItem(context);
    const panels = {};
    context.subscriptions.forEach((item, i) => { panels[PANEL_ORDER[i]] = item; });
    panels.all = context.subscriptions;
    return panels;
}

function tip(item) {
    return typeof item.tooltip === 'string' ? item.tooltip : (item.tooltip?.value ?? '');
}

const SESSION = { tokenUsage: { current: 50_000, limit: 200_000, limitConfidence: 'authoritative' } };

function usage(overrides = {}) {
    return {
        usagePercent: 10,
        resetsAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
        usagePercentWeek: 20,
        resetsAtWeek: new Date(Date.now() + 3 * 86400_000).toISOString(),
        scopedWeekly: [],
        accountInfo: null,
        timestamp: new Date(),
        ...overrides,
    };
}

function authError(authReason) {
    const err = new Error('rendered elsewhere');
    err.authReason = authReason;
    err.authContext = {};
    return err;
}

afterEach(() => {
    vscode._setRemoteName(undefined);
    vi.useRealTimers();
});

describe('updateStatusBar - something stays clickable', () => {
    it('compact, logged out, Tk session goes idle: a FETCH_NOW item is still visible', () => {
        const panels = freshPanels({ 'statusBar.displayMode': 'compact' });
        updateStatusBar(null, null, null, SESSION, null);
        updateStatusBar(null, null, null, null, null);
        const visible = panels.all.filter((i) => i.visible);
        expect(visible.length).toBeGreaterThan(0);
        expect(visible.every((i) => i.command === COMMANDS.FETCH_NOW)).toBe(true);
    });
});

describe('fetch errors survive re-renders without piling up', () => {
    it('a repeated failure in compact mode shows one marker, not one per fetch', () => {
        const panels = freshPanels({ 'statusBar.displayMode': 'compact' });
        for (let i = 0; i < 3; i++) {
            updateStatusBar(null, usage(), null, SESSION, null);
            stopSpinner(new Error('API_ERROR_500'), null);
        }
        expect(panels.compact.text.split('⚠').length - 1).toBe(1);
    });

    it('the next local refresh tick keeps the "Click to log in" state', () => {
        const panels = freshPanels();
        updateStatusBar(null, null, null, null, null);
        stopSpinner(authError('NO_TOKEN'), new Error('No token data available'));
        updateStatusBar(null, null, null, null, null);
        expect(tip(panels.label)).toContain('Click to log into Claude Code');
        expect(panels.label.text).toContain('⚠');
    });

    it('a tick with usage data keeps the web error too', () => {
        const panels = freshPanels();
        updateStatusBar(null, usage(), null, SESSION, null);
        stopSpinner(new Error('API_ERROR_500'), null);
        updateStatusBar(null, usage(), null, SESSION, null);
        expect(tip(panels.session)).toContain('Web Fetch Failed');
        expect(panels.label.text).toContain('⚠');
    });

    it('a clean fetch clears it', () => {
        const panels = freshPanels();
        updateStatusBar(null, usage(), null, SESSION, null);
        stopSpinner(new Error('API_ERROR_500'), null);
        updateStatusBar(null, usage(), null, SESSION, null);
        stopSpinner(null, null);
        updateStatusBar(null, usage(), null, SESSION, null);
        expect(tip(panels.session)).not.toContain('Web Fetch Failed');
        expect(panels.label.text).not.toContain('⚠');
    });

    it('the marker sits on the compact panel once compact is showing', () => {
        const panels = freshPanels({ 'statusBar.displayMode': 'compact' });
        updateStatusBar(null, usage(), null, SESSION, null);
        stopSpinner(new Error('API_ERROR_500'), null);
        expect(panels.compact.visible).toBe(true);
        expect(panels.compact.text).toContain('⚠');
        expect(panels.label.visible).toBe(false);
    });
});

describe('a hidden panel comes back', () => {
    it('credits reappear after compact -> default', () => {
        const credits = { used: 10, limit: 100, currency: 'USD', percent: 10 };
        const panels = freshPanels({ 'statusBar.showCredits': true });
        updateStatusBar(null, usage({ monthlyCredits: credits }), null, SESSION, null);
        expect(panels.credits.visible).toBe(true);
        vscode._setConfigValues({ 'statusBar.displayMode': 'compact' });
        updateStatusBar(null, usage({ monthlyCredits: credits }), null, SESSION, null);
        expect(panels.credits.visible).toBe(false);
        vscode._setConfigValues({ 'statusBar.displayMode': 'default' });
        updateStatusBar(null, usage({ monthlyCredits: credits }), null, SESSION, null);
        expect(panels.credits.visible).toBe(true);
    });

    it('tokenOnlyMode Tk leaves "Tk --" when the session resumes', () => {
        const panels = freshPanels({ tokenOnlyMode: true });
        updateStatusBar(null, null, null, SESSION, null);
        const live = panels.tokens.text;
        updateStatusBar(null, null, null, null, null);
        expect(panels.tokens.text).toBe('Tk --');
        updateStatusBar(null, null, null, SESSION, null);
        expect(panels.tokens.text).toBe(live);
    });
});

describe('credits panel text', () => {
    // usageFormat is read through inspect() for its platform-aware default.
    const creditsPanel = (credits, settings = {}) => {
        const panels = freshPanels({ 'statusBar.showCredits': true, ...settings });
        vscode._setConfigInspectValues('statusBar.usageFormat', { globalValue: 'percent' });
        updateStatusBar(null, usage({ monthlyCredits: credits }), null, SESSION, null);
        return panels.credits;
    };

    it('shows used at 1M or more as 1.5M, not 1500.0K', () => {
        const panel = creditsPanel({ used: 1_500_000, limit: 2_000_000, currency: 'USD', percent: 75 });
        expect(panel.text).toContain('$1.5M/75%');
    });

    it('keeps the K and whole-number forms below 1M', () => {
        expect(creditsPanel({ used: 2_500, limit: 5_000, currency: 'USD', percent: 50 }).text)
            .toContain('$2.5K/50%');
        expect(creditsPanel({ used: 10, limit: 100, currency: 'USD', percent: 10 }).text)
            .toContain('$10/10%');
    });

    it('renders a null percent as "-", never "null%"', () => {
        const panel = creditsPanel({ used: 10, limit: 100, currency: 'USD', percent: null });
        expect(panel.text).toContain('$10/-');
        expect(panel.text).not.toContain('null');
    });

    it('renders a NaN percent as "-", never "NaN%"', () => {
        const panel = creditsPanel({ used: 10, limit: 100, currency: 'USD', percent: NaN });
        expect(panel.text).toContain('$10/-');
        expect(panel.text).not.toContain('NaN');
    });
});

describe('reset times are computed at render from the stamp', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-16T00:00:00Z'));
    });

    const raw = (fiveHourReset) => ({
        five_hour: { utilization: 40, resets_at: fiveHourReset },
        seven_day: { utilization: 10, resets_at: '2026-10-20T00:00:00Z' },
    });

    it('counts down from the stamp, not from when the data was fetched', () => {
        const fetched = processApiResponse(raw('2026-10-16T02:30:00Z'), null, null, null);
        vi.setSystemTime(new Date('2026-10-16T01:00:00Z'));
        const panels = freshPanels();
        updateStatusBar(null, fetched, null, null, null);
        expect(panels.session.text).toMatch(/\$\(history\) 1h 30m$/);
    });

    it('shows "-" when the payload carries no reset stamp', () => {
        const fetched = processApiResponse(raw(null), null, null, null);
        const panels = freshPanels();
        updateStatusBar(null, fetched, null, null, null);
        expect(panels.session.text).toMatch(/\$\(history\) -$/);
    });

    it('reads a cache entry an older version wrote as a duration string', () => {
        const cached = upgradeCachedUsage({
            usagePercent: 40,
            resetTime: '4h 0m',
            usagePercentWeek: 10,
            resetTimeWeek: '4d 0h',
            rawData: raw('2026-10-16T01:00:00Z'),
            timestamp: '2026-10-15T21:00:00.000Z',
        });
        const panels = freshPanels();
        updateStatusBar(null, cached, null, null, null);
        expect(panels.session.text).toMatch(/\$\(history\) 1h 0m$/);
    });
});

describe('compact mode follows the shared gauge helpers', () => {
    it('turns red for a scoped cap past its error threshold', () => {
        const panels = freshPanels({ 'statusBar.displayMode': 'compact' });
        updateStatusBar(null, usage({ scopedWeekly: [{ label: 'Fable', percent: 95 }] }), null, SESSION, null);
        expect(panels.compact.color?.id).toBe('claudemeter.outageRed');
    });

    it('uses the gauges.labels name for the context gauge', () => {
        const panels = freshPanels({
            'statusBar.displayMode': 'compact',
            'gauges.labels': { tokens: { compact: 'Ctx' } },
        });
        updateStatusBar(null, usage(), null, SESSION, null);
        expect(panels.compact.text).toContain('Ctx-');
        expect(panels.compact.text).not.toContain('Tk-');
    });
});

describe('the tooltip follows the gauge settings the status bar uses', () => {
    it('lists a gauge added by gauges.definitions', () => {
        const panels = freshPanels({
            'gauges.definitions': {
                fiveDay: { tooltipLabel: 'Five day', source: { percentPath: 'five_day.utilization' } },
            },
        });
        updateStatusBar(null, usage({
            rawData: { five_day: { utilization: 33 } },
        }), null, null, null);
        expect(tip(panels.label)).toContain('Five day 33%');
    });

    it('applies a gauges.labels tooltip name to a scoped cap', () => {
        const panels = freshPanels({ 'gauges.labels': { Fable: { tooltip: 'Fable cap' } } });
        updateStatusBar(null, usage({ scopedWeekly: [{ label: 'Fable', percent: 72 }] }), null, null, null);
        expect(tip(panels.label)).toContain('Fable cap 72%');
    });
});

describe('remote windows', () => {
    it('hide the Tk panel but keep the tooltip explanation', () => {
        vscode._setRemoteName('ssh-remote');
        const panels = freshPanels();
        updateStatusBar(null, usage(), null, null, null);
        expect(panels.tokens.visible).toBe(false);
        expect(tip(panels.label)).toContain('Current context - unavailable here');
    });

    it('drop the Tk placeholder from the compact panel', () => {
        vscode._setRemoteName('ssh-remote');
        const panels = freshPanels({ 'statusBar.displayMode': 'compact' });
        updateStatusBar(null, usage(), null, null, null);
        expect(panels.compact.text).not.toContain('Tk');
    });

    it('show Tk when claudemeter runs on the remote host itself', () => {
        vscode._setRemoteName('ssh-remote', vscode.ExtensionKind.Workspace);
        const panels = freshPanels();
        updateStatusBar(null, usage(), null, SESSION, null);
        expect(panels.tokens.visible).toBe(true);
        expect(tip(panels.label)).toContain('Tokens 50.0K');
        expect(tip(panels.label)).not.toContain('unavailable here');
    });

    it('default to block bars, since the client OS drawing them is unknown', () => {
        vscode._setRemoteName('ssh-remote', vscode.ExtensionKind.Workspace);
        const panels = freshPanels();
        updateStatusBar(null, usage(), null, SESSION, null);
        expect(panels.session.text).toContain('░');
        expect(panels.session.text).not.toContain('○');
    });

    it('keep an explicit usageFormat over the remote default', () => {
        vscode._setRemoteName('ssh-remote', vscode.ExtensionKind.Workspace);
        const panels = freshPanels();
        vscode._setConfigInspectValues('statusBar.usageFormat', { globalValue: 'barCircle' });
        updateStatusBar(null, usage(), null, SESSION, null);
        expect(panels.session.text).toContain('○');
    });

    it('still hide Tk when running on the client of the remote window', () => {
        vscode._setRemoteName('ssh-remote', vscode.ExtensionKind.UI);
        const panels = freshPanels();
        updateStatusBar(null, usage(), null, SESSION, null);
        expect(panels.tokens.visible).toBe(false);
    });
});

describe('tooltip command trust', () => {
    it('enables only the Nopilot commands the tooltip links', () => {
        const panels = freshPanels();
        updateStatusBar(null, usage(), null, SESSION, null);
        expect(panels.label.tooltip.isTrusted).toEqual({
            enabledCommands: [COMMANDS.NOPILOT, COMMANDS.NOPILOT_DISMISS],
        });
    });

    it('enables no commands on an error tooltip', () => {
        const panels = freshPanels();
        stopSpinner(authError('NO_TOKEN'), null);
        expect(panels.label.tooltip.isTrusted).toEqual({ enabledCommands: [] });
    });

    it('escapes a hostile organisation name', () => {
        const hostile = 'Evil [x](command:workbench.action.terminal.sendSequence?%7B%7D) <command:foo>';
        const panels = freshPanels();
        updateStatusBar(null, usage({ accountInfo: { name: hostile, email: hostile, orgName: hostile } }),
            null, null, { subscriptionType: 'max' });
        const out = tip(panels.label);
        expect(out).not.toContain('[x](command:');
        expect(out).not.toContain('<command:foo>');
    });
});

describe('panel layout', () => {
    it('creates every panel with its priority offset and the fetch command', () => {
        const panels = freshPanels({ 'statusBar.priority': 500, 'statusBar.alignment': 'left' });
        const offsets = panels.all.map((i) => Math.round((i.priority - 500) * 100) / 100);
        expect(offsets).toEqual([0.9, 0.85, 0.8, 0.7, 0.6, 0.5, 0.45, 0.3, 0.2, 0.7]);
        expect(panels.all.every((i) => i.alignment === vscode.StatusBarAlignment.Left)).toBe(true);
        expect(panels.all.every((i) => i.command === COMMANDS.FETCH_NOW)).toBe(true);
        expect(panels.spinner.text).toBe('$(sync~spin)');
        expect(panels.spinner.tooltip).toBe('Checking Claude...');
        expect(panels.label.visible).toBe(true);
    });
});

describe('Se and Wk panel text', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-16T00:00:00Z'));
    });

    const fetched = () => usage({
        usagePercent: 85,
        resetsAt: '2026-10-16T02:30:00Z',
        usagePercentWeek: 20,
        resetsAtWeek: '2026-10-19T00:00:00Z',
    });

    // usageFormat is read through inspect() for its platform-aware default.
    const percentPanels = (settings) => {
        const panels = freshPanels(settings);
        vscode._setConfigInspectValues('statusBar.usageFormat', { globalValue: 'percent' });
        return panels;
    };

    it('default mode carries the reset time and the threshold icon', () => {
        const panels = percentPanels({ 'statusBar.showThresholdIcons': true });
        updateStatusBar(null, fetched(), null, null, null);
        expect(panels.session.text).toBe('$(warning) Se 85% $(history) 2h 30m');
        expect(panels.session.color?.id).toBe('charts.yellow');
        expect(panels.weekly.text).toBe('Wk 20% $(history) 3d 0h');
        expect(panels.weekly.color).toBeUndefined();
    });

    it('minimal mode drops the reset time', () => {
        const panels = percentPanels({ 'statusBar.displayMode': 'minimal' });
        updateStatusBar(null, fetched(), null, null, null);
        expect(panels.session.text).toBe('Se 85%');
        expect(panels.weekly.text).toBe('Wk 20%');
    });

    it('a gauge with no percent is hidden', () => {
        const panels = percentPanels({});
        updateStatusBar(null, fetched(), null, null, null);
        updateStatusBar(null, null, null, SESSION, null);
        expect(panels.session.visible).toBe(false);
        expect(panels.weekly.visible).toBe(false);
    });
});

describe('critical outage', () => {
    const serviceStatus = require('../../src/serviceStatus');
    afterEach(() => serviceStatus.setSimulatedStatus('clear'));

    it('paints and re-tooltips every panel but the transient ones', () => {
        serviceStatus.setSimulatedStatus('critical');
        const panels = freshPanels();
        updateStatusBar(null, usage(), null, SESSION, null);
        const transient = [panels.spinner, panels.happyHour];
        const primary = panels.all.filter((i) => !transient.includes(i));
        expect(primary.every((i) => i.backgroundColor?.id === 'statusBarItem.errorBackground')).toBe(true);
        expect(transient.every((i) => i.backgroundColor === undefined)).toBe(true);
        expect(primary.every((i) => tip(i).includes("He's dead, Jim."))).toBe(true);
        expect(panels.spinner.tooltip).toBe('Checking Claude...');
        expect(panels.label.color?.id).toBe('claudemeter.outageRed');
    });
});

describe('happy-hour panel', () => {
    const simulator = require('../../src/simulator');
    afterEach(() => simulator.clearAll());

    it('states when happy hour ends in the long form', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-16T00:00:00Z'));
        simulator.setHappyHour(true);
        const panels = freshPanels({ 'statusBar.timeFormat': '24hour' });
        updateStatusBar(null, usage(), null, null, null);
        const expected = new Date('2026-10-16T01:00:00Z').toLocaleString(undefined, {
            weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: false,
        });
        expect(panels.happyHour.visible).toBe(true);
        expect(tip(panels.happyHour)).toBe(`**Happy hour** — off-peak, ends ${expected}`);
    });
});

describe('Tk profile detection from the render path', () => {
    const { resetUnknownWarning } = require('../../src/tk/profileSelector');
    const warnings = () => vscode._getOutputChannels()
        .flatMap((c) => c.lines)
        .filter((l) => l.includes('profile detection fell through'));

    beforeEach(() => {
        resetUnknownWarning();
        require('../../src/utils').disposeDebugChannel();
        vscode._resetOutputChannels();
    });

    it('logs the unknown-profile warning once when no signal lands', () => {
        freshPanels();
        updateStatusBar(null, usage(), null, SESSION, {});
        updateStatusBar(null, usage(), null, SESSION, {});
        expect(warnings()).toHaveLength(1);
    });

    it('reaches the enterprise profile from the local plan token', () => {
        freshPanels();
        updateStatusBar(null, usage(), null, SESSION, { organizationType: 'claude_enterprise' });
        expect(warnings()).toHaveLength(0);
    });

    it('reaches the team profile from the /profile plan token', () => {
        freshPanels();
        updateStatusBar(null, usage({ accountInfo: { organizationType: 'claude_team' } }), null, SESSION, {});
        expect(warnings()).toHaveLength(0);
    });
});
