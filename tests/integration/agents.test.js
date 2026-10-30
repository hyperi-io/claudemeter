// Supplementary agents: the Codex app-server client against a real child process (a fake
// app-server script), the parse of its rate limits, and the registry's cache and isolation.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const path = require('path');
const codex = require('../../src/agents/codex');
const { windowLabel, headlineLimit } = require('../../src/agents/limits');
const { readAgents, resetAgentCache, MIN_READ_INTERVAL_MS } = require('../../src/agents/registry');

const FAKE = path.join(__dirname, '..', 'common', 'fakeCodex.js');
const POSIX = process.platform !== 'win32';

const LIVE_RESULT = {
    rateLimits: {
        limitId: 'codex',
        limitName: null,
        primary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 1793823507 },
        secondary: null,
        credits: { hasCredits: false, unlimited: false, balance: '0' },
        planType: 'prolite',
    },
    rateLimitsByLimitId: {
        codex: {
            limitId: 'codex',
            limitName: null,
            primary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 1793823507 },
            secondary: null,
            credits: { hasCredits: false, unlimited: false, balance: '0' },
            planType: 'prolite',
        },
    },
    rateLimitResetCredits: { availableCount: 2, credits: [] },
};

describe('parseRateLimits', () => {
    it('reads the live shape: one weekly window, the plan and the free resets', () => {
        expect(codex.parseRateLimits(LIVE_RESULT)).toEqual({
            plan: 'prolite',
            limits: [{ label: '7d', percent: 0, windowMinutes: 10080, resetsAt: 1793823507000 }],
            notes: ['2 free limit resets available'],
        });
    });

    it.each([
        ['both windows, a named model limit beside the account one', {
            rateLimitsByLimitId: {
                codex: { limitName: null, primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 10 }, secondary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: 20 } },
                spark: { limitName: 'Spark', primary: { usedPercent: 90, windowDurationMins: 300, resetsAt: 30 } },
            },
        }, ['5h 40%', '7d 5%', 'Spark 5h 90%']],
        ['only the legacy rateLimits field', { rateLimits: { primary: { usedPercent: 7, windowDurationMins: 60 } } }, ['1h 7%']],
        ['a window with no length', { rateLimits: { primary: { usedPercent: 7 } } }, ['Limit 7%']],
    ])('%s', (_name, result, want) => {
        expect(codex.parseRateLimits(result).limits.map((l) => `${l.label} ${l.percent}%`)).toEqual(want);
    });

    it.each([
        ['unlimited credits', { unlimited: true }, ['Unlimited credits']],
        ['a credit balance', { hasCredits: true, balance: '12.50' }, ['Credit balance 12.50']],
        ['no credits', { hasCredits: false, balance: '0' }, []],
    ])('notes %s', (_name, credits, want) => {
        const result = { rateLimits: { primary: { usedPercent: 1, windowDurationMins: 300 }, credits } };
        expect(codex.parseRateLimits(result).notes).toEqual(want);
    });

    it.each([
        ['null', null],
        ['a string', 'nope'],
        ['no limits at all', { rateLimits: null, rateLimitsByLimitId: {} }],
        ['windows without a percent', { rateLimits: { primary: { usedPercent: 'lots' }, secondary: null } }],
        ['junk entries in the map', { rateLimitsByLimitId: { a: null, b: 7, c: 'x' } }],
    ])('returns null for %s', (_name, result) => {
        expect(codex.parseRateLimits(result)).toBeNull();
    });
});

describe('limits helpers', () => {
    it.each([[300, '5h'], [10080, '7d'], [1440, '1d'], [90, '90m'], [60, '1h']])('%s minutes is %s', (minutes, want) => {
        expect(windowLabel(minutes)).toBe(want);
    });

    it('takes the fullest limit as the headline, and of equals the one that resets first', () => {
        const a = { percent: 40, resetsAt: 200 };
        const b = { percent: 40, resetsAt: 100 };
        const c = { percent: 10, resetsAt: 50 };
        expect(headlineLimit([a, b, c])).toBe(b);
        expect(headlineLimit([c])).toBe(c);
        expect(headlineLimit([])).toBeNull();
        expect(headlineLimit(undefined)).toBeNull();
    });
});

describe.runIf(POSIX)('readCodexUsage against a fake app-server', () => {
    afterEach(() => {
        delete process.env.FAKE_CODEX_MODE;
    });

    it('initialises, asks for the limits and returns them', async () => {
        const usage = await codex.readCodexUsage({ command: FAKE });
        expect(usage.plan).toBe('pro');
        expect(usage.limits.map((l) => [l.label, l.percent])).toEqual([['5h', 42], ['7d', 12.5]]);
        expect(usage.notes).toEqual(['1 free limit reset available']);
    });

    it.each([
        ['the command does not exist', { command: '/nonexistent/codex' }, null],
        ['the server answers with an error (signed out)', { command: FAKE }, 'error'],
        ['the server exits at once', { command: FAKE }, 'exit'],
        ['the server prints garbage and repeats its initialize reply instead of answering the read', { command: FAKE, timeoutMs: 1500 }, 'garbage'],
        ['the server hangs', { command: FAKE, timeoutMs: 1500 }, 'hang'],
    ])('resolves null when %s', async (_name, options, mode) => {
        if (mode) process.env.FAKE_CODEX_MODE = mode;
        const started = Date.now();
        expect(await codex.readCodexUsage(options)).toBeNull();
        expect(Date.now() - started).toBeLessThan(5000);
    });
});

describe('readAgents', () => {
    beforeEach(resetAgentCache);

    const provider = (id, read) => ({ id, name: id, shortLabel: id.slice(0, 2), read });
    const usage = { plan: null, limits: [{ label: '5h', percent: 10, windowMinutes: 300, resetsAt: null }], notes: [] };
    const on = () => ({ enabled: true, command: 'x' });

    it('reads each enabled provider once per interval and serves the cached result between', async () => {
        let calls = 0;
        const providers = [provider('aa', async () => { calls++; return usage; })];
        await readAgents(on, { providers, now: 0 });
        const again = await readAgents(on, { providers, now: MIN_READ_INTERVAL_MS - 1 });
        expect(calls).toBe(1);
        expect(again).toEqual([{ id: 'aa', name: 'aa', shortLabel: 'aa', usage, readAt: 0 }]);
        await readAgents(on, { providers, now: MIN_READ_INTERVAL_MS });
        expect(calls).toBe(2);
    });

    it('reads again at once when the command setting changes', async () => {
        let calls = 0;
        const providers = [provider('aa', async () => { calls++; return usage; })];
        await readAgents(on, { providers, now: 0 });
        await readAgents(() => ({ enabled: true, command: 'y' }), { providers, now: 1 });
        expect(calls).toBe(2);
    });

    it('leaves out a disabled, absent or failing provider without touching the others', async () => {
        const providers = [
            provider('off', async () => usage),
            provider('absent', async () => null),
            provider('broken', async () => { throw new Error('boom'); }),
            provider('ok', async () => usage),
        ];
        const settings = (id) => ({ enabled: id !== 'off', command: id });
        expect((await readAgents(settings, { providers, now: 0 })).map((a) => a.id)).toEqual(['ok']);
    });

    it('registers Codex as a provider', () => {
        expect(require('../../src/agents/registry').PROVIDERS.map((p) => [p.id, p.shortLabel])).toEqual([['codex', 'Cx']]);
    });
});

describe('agentSample', () => {
    const { agentSample, agentSeries } = require('../../src/agents/registry');
    const agent = (id, limits) => ({ id, name: id, shortLabel: id, usage: { plan: null, limits, notes: [] } });

    it('keeps each agent headline limit under its own series, with no Claude gauges', () => {
        const sample = agentSample([
            agent('codex', [{ label: '5h', percent: 10, resetsAt: 100 }, { label: '7d', percent: 30, resetsAt: 900 }]),
            agent('other', [{ label: '1d', percent: 5, resetsAt: 50 }]),
        ], 1234);
        expect(sample).toEqual({
            ts: 1234,
            fiveHour: { pct: null, resetsAt: null },
            sevenDay: { pct: null, resetsAt: null },
            scoped: { [agentSeries('codex')]: { pct: 30, resetsAt: 900 }, [agentSeries('other')]: { pct: 5, resetsAt: 50 } },
        });
    });

    it('is null when no agent has a limit', () => {
        expect(agentSample([], 1)).toBeNull();
        expect(agentSample([agent('codex', [])], 1)).toBeNull();
    });
});
