// VS Code re-renders an open status bar hover whenever the tooltip text
// changes, so a tick that changes nothing must leave the text identical.

import { it, expect, vi, afterEach } from 'vitest';
const vscode = require('vscode');
const { createStatusBarItem, updateStatusBar } = require('../../src/statusBar');
const { getStats } = require('../../src/activityMonitor');

afterEach(() => {
    vi.useRealTimers();
});

it('a local tick with unchanged data leaves every tooltip unchanged', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T01:00:00Z'));
    vscode._resetConfigValues();
    const context = { subscriptions: [] };
    createStatusBarItem(context);
    const usage = {
        usagePercent: 10,
        resetsAt: '2026-10-16T03:00:00Z',
        usagePercentWeek: 20,
        resetsAtWeek: '2026-10-19T00:00:00Z',
        scopedWeekly: [{ label: 'Fable', percent: 7 }],
        accountInfo: null,
        timestamp: new Date('2026-10-16T00:59:00Z'),
    };
    const session = { tokenUsage: { current: 50_000, limit: 200_000, limitConfidence: 'authoritative' } };
    const tips = () => context.subscriptions.map((item) => item.tooltip?.value ?? item.tooltip);

    updateStatusBar(null, usage, getStats(usage, session), session, null);
    const first = tips();
    // 29 ten-second ticks stay inside the quip's five-minute hold.
    for (let i = 1; i <= 29; i++) {
        vi.setSystemTime(new Date(Date.parse('2026-10-16T01:00:00Z') + i * 10_000));
        updateStatusBar(null, usage, getStats(usage, session), session, null);
        expect(tips()).toEqual(first);
    }
});

it('holds changed stats to the 30 s refresh, then shows the newest, quip unchanged', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-10-16T02:00:00Z'));
    vscode._resetConfigValues();
    const context = { subscriptions: [] };
    createStatusBarItem(context);
    const usage = (percent) => ({
        usagePercent: percent,
        resetsAt: '2026-10-16T03:00:00Z',
        usagePercentWeek: 20,
        resetsAtWeek: '2026-10-19T00:00:00Z',
        scopedWeekly: [],
        accountInfo: null,
        timestamp: new Date('2026-10-16T01:59:00Z'),
    });
    const session = (current) => ({ tokenUsage: { current, limit: 200_000, limitConfidence: 'authoritative' } });
    const tip = () => context.subscriptions[0].tooltip.value;
    const quip = () => tip().split('\n').find((line) => /^\*[^*]/.test(line));

    updateStatusBar(null, usage(10), getStats(usage(10), session(50_000)), session(50_000), null);
    const heldQuip = quip();
    expect(heldQuip).toMatch(/^\*.+\*/);
    vi.advanceTimersByTime(10_000);
    updateStatusBar(null, usage(11), getStats(usage(11), session(55_000)), session(55_000), null);
    vi.advanceTimersByTime(5_000);
    updateStatusBar(null, usage(12), getStats(usage(12), session(60_000)), session(60_000), null);
    expect(tip()).toContain('**Session - 10%**');

    vi.advanceTimersByTime(15_000);
    expect(tip()).toContain('**Session - 12%**');
    expect(tip()).toContain('60.0K');
    expect(quip()).toBe(heldQuip);
});

it('shows another account at once, never holding the old one\'s numbers', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-10-16T03:00:00Z'));
    vscode._resetConfigValues();
    const context = { subscriptions: [] };
    createStatusBarItem(context);
    const usage = (percent) => ({
        usagePercent: percent,
        resetsAt: '2026-10-16T05:00:00Z',
        usagePercentWeek: 20,
        resetsAtWeek: '2026-10-19T00:00:00Z',
        scopedWeekly: [],
        accountInfo: null,
        timestamp: new Date('2026-10-16T02:59:00Z'),
    });
    const tip = () => context.subscriptions[0].tooltip.value;

    updateStatusBar(null, usage(10), null, null, { accountUuid: 'acct-a' });
    vi.advanceTimersByTime(1_000);
    updateStatusBar(null, usage(70), null, null, { accountUuid: 'acct-b' });
    expect(tip()).toContain('**Session - 70%**');
});
