import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const sim = require('../../src/simulator');

describe('simulator — null returns to live, set/get/clear semantics', () => {
    beforeEach(() => sim.clearAll());

    it('returns null for every getter when nothing simulated', () => {
        expect(sim.getTokenLevel()).toBe(null);
        expect(sim.getTokenUsed()).toBe(null);
        expect(sim.getSessionPercent()).toBe(null);
        expect(sim.getWeeklyPercent()).toBe(null);
        expect(sim.getScopedWeekly()).toBe(null);
        expect(sim.getThresholdIcons()).toBe(null);
        expect(sim.getContextWindow()).toBe(null);
        expect(sim.getPlanSignals()).toBe(null);
        expect(sim.getCreditsPercent()).toBe(null);
        expect(sim.getHappyHour()).toBe(null);
        expect(sim.getColorMode()).toBe(null);
        expect(sim.getProfileOverride()).toBe(null);
    });

    it('roundtrips token level', () => {
        sim.setTokenLevel('rotDeep');
        expect(sim.getTokenLevel()).toBe('rotDeep');
        sim.setTokenLevel(null);
        expect(sim.getTokenLevel()).toBe(null);
    });

    it('rejects invalid token levels', () => {
        sim.setTokenLevel('not-a-level');
        expect(sim.getTokenLevel()).toBe(null);
    });

    it('roundtrips token used and clamps negative', () => {
        sim.setTokenUsed(450_000);
        expect(sim.getTokenUsed()).toBe(450_000);
        sim.setTokenUsed(-1000);
        expect(sim.getTokenUsed()).toBe(0);
    });

    it('roundtrips percents and clamps 0..100', () => {
        sim.setSessionPercent(50);
        expect(sim.getSessionPercent()).toBe(50);
        sim.setSessionPercent(150);
        expect(sim.getSessionPercent()).toBe(100);
        sim.setSessionPercent(-10);
        expect(sim.getSessionPercent()).toBe(0);
    });

    it('rejects non-numeric percents', () => {
        sim.setSessionPercent('seventy');
        expect(sim.getSessionPercent()).toBe(null);
    });

    it('roundtrips scopedWeekly and clamps each percent 0..100', () => {
        sim.setScopedWeekly([{ label: 'Fable', percent: 42 }, { label: 'Opus', percent: 150 }]);
        expect(sim.getScopedWeekly()).toEqual([
            { label: 'Fable', percent: 42, modelId: null, resetsAt: null, severity: null },
            { label: 'Opus', percent: 100, modelId: null, resetsAt: null, severity: null },
        ]);
        sim.setScopedWeekly(null);
        expect(sim.getScopedWeekly()).toBe(null);
    });

    it('drops scopedWeekly entries with no label or a non-numeric percent', () => {
        sim.setScopedWeekly([
            { label: '', percent: 10 },
            { label: 'Fable', percent: 'fifty' },
            { label: 'Fable', percent: 7 },
        ]);
        expect(sim.getScopedWeekly()).toEqual([
            { label: 'Fable', percent: 7, modelId: null, resetsAt: null, severity: null },
        ]);
    });

    it('rejects a non-array scopedWeekly', () => {
        sim.setScopedWeekly('Fable 50%');
        expect(sim.getScopedWeekly()).toBe(null);
    });

    it('roundtrips thresholdIcons as a tri-state', () => {
        sim.setThresholdIcons(true);
        expect(sim.getThresholdIcons()).toBe(true);
        sim.setThresholdIcons(false);
        expect(sim.getThresholdIcons()).toBe(false);
        // null returns to the real setting rather than forcing either way.
        sim.setThresholdIcons(null);
        expect(sim.getThresholdIcons()).toBe(null);
    });

    it('roundtrips contextWindow and rejects zero or nonsense', () => {
        sim.setContextWindow(1_000_000);
        expect(sim.getContextWindow()).toBe(1_000_000);
        sim.setContextWindow(0);
        expect(sim.getContextWindow()).toBe(1_000_000);
        sim.setContextWindow('1m');
        expect(sim.getContextWindow()).toBe(1_000_000);
        sim.setContextWindow(null);
        expect(sim.getContextWindow()).toBe(null);
    });

    it('roundtrips planSignals with creditsEnabled tri-state', () => {
        sim.setPlanSignals({ subscriptionType: 'pro', organizationType: 'claude_pro', creditsEnabled: false });
        expect(sim.getPlanSignals()).toEqual({
            subscriptionType: 'pro', organizationType: 'claude_pro', creditsEnabled: false,
        });

        // An omitted credit state stays unknown rather than becoming false.
        sim.setPlanSignals({ subscriptionType: 'max' });
        expect(sim.getPlanSignals().creditsEnabled).toBe(null);

        sim.setPlanSignals(null);
        expect(sim.getPlanSignals()).toBe(null);
    });

    it('roundtrips creditsPercent and clamps 0..100', () => {
        sim.setCreditsPercent(75);
        expect(sim.getCreditsPercent()).toBe(75);
        sim.setCreditsPercent(101);
        expect(sim.getCreditsPercent()).toBe(100);
        sim.setCreditsPercent(0);
        expect(sim.getCreditsPercent()).toBe(0);
        sim.setCreditsPercent(null);
        expect(sim.getCreditsPercent()).toBe(null);
    });

    it('roundtrips happyHour as strict boolean', () => {
        sim.setHappyHour(true);
        expect(sim.getHappyHour()).toBe(true);
        sim.setHappyHour(0);
        expect(sim.getHappyHour()).toBe(false);
        sim.setHappyHour(null);
        expect(sim.getHappyHour()).toBe(null);
    });

    it('roundtrips colorMode with validation', () => {
        sim.setColorMode('basic');
        expect(sim.getColorMode()).toBe('basic');
        sim.setColorMode('rainbow');
        expect(sim.getColorMode()).toBe('basic');  // rejected, prior value kept
    });

    it('roundtrips profileOverride as string', () => {
        sim.setProfileOverride('max-20x');
        expect(sim.getProfileOverride()).toBe('max-20x');
        sim.setProfileOverride('');
        expect(sim.getProfileOverride()).toBe('max-20x');  // empty rejected
        sim.setProfileOverride(null);
        expect(sim.getProfileOverride()).toBe(null);
    });

    it('clearAll resets every value', () => {
        sim.setTokenLevel('error');
        sim.setTokenUsed(800_000);
        sim.setSessionPercent(50);
        sim.setWeeklyPercent(30);
        sim.setScopedWeekly([{ label: 'Fable', percent: 20 }]);
        sim.setThresholdIcons(true);
        sim.setContextWindow(1_000_000);
        sim.setPlanSignals({ subscriptionType: 'pro' });
        sim.setCreditsPercent(80);
        sim.setHappyHour(true);
        sim.setColorMode('basic');
        sim.setProfileOverride('pro');

        sim.clearAll();

        expect(sim.getTokenLevel()).toBe(null);
        expect(sim.getTokenUsed()).toBe(null);
        expect(sim.getSessionPercent()).toBe(null);
        expect(sim.getWeeklyPercent()).toBe(null);
        expect(sim.getScopedWeekly()).toBe(null);
        expect(sim.getThresholdIcons()).toBe(null);
        expect(sim.getContextWindow()).toBe(null);
        expect(sim.getPlanSignals()).toBe(null);
        expect(sim.getCreditsPercent()).toBe(null);
        expect(sim.getHappyHour()).toBe(null);
        expect(sim.getColorMode()).toBe(null);
        expect(sim.getProfileOverride()).toBe(null);
    });
});

describe('simulator commands - registration and palette gating', () => {
    const vscode = require('vscode');
    const { registerSimulatorCommands } = require('../../src/commands/simulator');
    const pkg = require('../../package.json');
    const contributed = new Map(pkg.contributes.commands.map((c) => [c.command, c]));

    const registeredIds = () => {
        const context = { subscriptions: [] };
        const ids = [];
        const real = vscode.commands.registerCommand;
        vscode.commands.registerCommand = (id, handler) => { ids.push(id); return real(id, handler); };
        try {
            registerSimulatorCommands(context, async () => {});
        } finally {
            vscode.commands.registerCommand = real;
        }
        return ids;
    };

    it('registers the 14 simulate commands', () => {
        expect(registeredIds()).toHaveLength(14);
    });

    it('hides every simulate command, simulateStatus included, unless debug is on', () => {
        const devOnly = [...registeredIds(), 'claudemeter.simulateStatus'];
        for (const id of devOnly) {
            expect(contributed.get(id)?.enablement, id).toBe('config.claudemeter.debug');
        }
    });
});

describe('simulator scenarios - one JSON object replaces every simulated state', () => {
    beforeEach(() => sim.clearAll());

    it('applies every named state and reports the keys it used', () => {
        const applied = sim.applyScenario({
            sessionPercent: 91,
            weeklyPercent: 42,
            tokenUsed: 450_000,
            contextWindow: 1_000_000,
            profileOverride: 'max-20x',
            colorMode: 'color',
        });
        expect(applied).toEqual([
            'sessionPercent', 'weeklyPercent', 'tokenUsed', 'contextWindow', 'profileOverride', 'colorMode',
        ]);
        expect(sim.getSessionPercent()).toBe(91);
        expect(sim.getWeeklyPercent()).toBe(42);
        expect(sim.getTokenUsed()).toBe(450_000);
        expect(sim.getContextWindow()).toBe(1_000_000);
        expect(sim.getProfileOverride()).toBe('max-20x');
    });

    it('drops what the previous scenario set', () => {
        sim.applyScenario({ sessionPercent: 91, tokenLevel: 'error' });
        sim.applyScenario({ weeklyPercent: 10 });
        expect(sim.getSessionPercent()).toBe(null);
        expect(sim.getTokenLevel()).toBe(null);
        expect(sim.getWeeklyPercent()).toBe(10);
    });

    it.each([
        ['an unknown key', { sessionPercent: 5, madeUp: 1 }, ['sessionPercent']],
        ['a prototype key', JSON.parse('{"__proto__": {"x": 1}, "weeklyPercent": 7}'), ['weeklyPercent']],
        ['null', null, []],
        ['an array', [1, 2], []],
        ['a string', 'sessionPercent', []],
    ])('ignores %s', (_name, scenario, applied) => {
        expect(sim.applyScenario(scenario)).toEqual(applied);
    });

    it.each([
        ['a session and weekly body', { session: '$(claudemeter-bar-2)', weekly: 'x' }, '$(claudemeter-bar-2)', 'x'],
        ['an unknown gauge and a non-string', { tokens: 'x', weekly: 7 }, null, null],
        ['an array', ['x'], null, null],
    ])('panelBody keeps only string bodies for session and weekly: %s', (_name, bodies, session, weekly) => {
        sim.applyScenario({ panelBody: bodies });
        expect(sim.getPanelBody('session')).toBe(session);
        expect(sim.getPanelBody('weekly')).toBe(weekly);
        sim.clearAll();
        expect(sim.getPanelBody('session')).toBe(null);
    });
});

describe('simulate.scenario command - reads the file CLAUDEMETER_SIMULATE_FILE names', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const vscode = require('vscode');
    const { registerSimulatorCommands } = require('../../src/commands/simulator');
    let dir;
    let calls;

    // Registers the commands against recording callbacks and runs the scenario handler.
    const run = async () => {
        const context = { subscriptions: [] };
        const real = vscode.commands.registerCommand;
        let handler;
        vscode.commands.registerCommand = (id, h) => {
            if (id === 'claudemeter.simulate.scenario') handler = h;
            return real(id, h);
        };
        try {
            registerSimulatorCommands(
                context,
                async () => { calls.push('fetch'); },
                async () => { calls.push('tokens'); },
            );
        } finally {
            vscode.commands.registerCommand = real;
        }
        await handler();
    };

    beforeEach(() => {
        sim.clearAll();
        calls = [];
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemeter-scenario-'));
    });

    afterEach(() => {
        delete process.env.CLAUDEMETER_SIMULATE_FILE;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('applies the file, then refreshes the local state before the fetch redraws', async () => {
        const file = path.join(dir, 's.json');
        fs.writeFileSync(file, JSON.stringify({ sessionPercent: 77, contextWindow: 200_000 }));
        process.env.CLAUDEMETER_SIMULATE_FILE = file;
        await run();
        expect(sim.getSessionPercent()).toBe(77);
        expect(sim.getContextWindow()).toBe(200_000);
        expect(calls).toEqual(['tokens', 'fetch']);
    });

    it.each([
        ['the variable is unset', () => undefined],
        ['the file is missing', (d) => path.join(d, 'absent.json')],
        ['the file is not JSON', (d) => {
            const f = path.join(d, 'bad.json');
            fs.writeFileSync(f, '{nope');
            return f;
        }],
    ])('changes nothing when %s', async (_name, pick) => {
        sim.setSessionPercent(33);
        const file = pick(dir);
        if (file) process.env.CLAUDEMETER_SIMULATE_FILE = file;
        await run();
        expect(sim.getSessionPercent()).toBe(33);
        expect(calls).toEqual([]);
    });
});

describe('simulator scenarios - burn states', () => {
    const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
    beforeEach(() => sim.clearAll());

    it('turns relative-minute history rows into samples stamped from now', () => {
        sim.applyScenario({
            usageHistory: { fiveResetsInMin: 60, weekResetsInMin: 600, samples: [[30, 10, 40, { 'scoped:fable': 5 }], [0, 20, 41]] },
        });
        const [first, last] = sim.getUsageHistory(NOW);
        expect(first.ts).toBe(NOW - 30 * 60_000);
        expect(first.fiveHour).toEqual({ pct: 10, resetsAt: NOW + 60 * 60_000 });
        expect(first.sevenDay).toEqual({ pct: 40, resetsAt: NOW + 600 * 60_000 });
        expect(first.scoped).toEqual({ 'scoped:fable': { pct: 5, resetsAt: NOW + 600 * 60_000 } });
        expect(last.ts).toBe(NOW);
        expect(last.scoped).toEqual({});
    });

    it.each([
        ['rows that are not triples', { samples: [[1, 2], 'x', null, [0, 5, 6]] }, 1],
        ['no samples list', { fiveResetsInMin: 5 }, null],
        ['an array', [[0, 1, 2]], null],
        ['null', null, null],
    ])('history ignores %s', (_name, spec, count) => {
        sim.applyScenario({ usageHistory: spec });
        expect(sim.getUsageHistory(NOW)?.length ?? null).toBe(count);
    });

    it('forces a run-out per gauge, keeping only positive minutes for session and weekly', () => {
        sim.applyScenario({ runsOut: { session: 40, weekly: -1, tokens: 5 } });
        expect(sim.getRunsOut('session')).toBe(40);
        expect(sim.getRunsOut('weekly')).toBe(null);
        expect(sim.getRunsOut('tokens')).toBe(null);
    });

    it.each([
        ['a number', 14, 14],
        ['a negative number', -20, -20],
        ['a string', '14', null],
        ['NaN', NaN, null],
    ])('paceDelta takes %s', (_name, value, expected) => {
        sim.applyScenario({ paceDelta: value });
        expect(sim.getPaceDelta()).toBe(expected);
    });

    it('turns Tk rows into turns stamped from now and drops bad rows', () => {
        sim.applyScenario({ tkSeries: [[4, 20_000], [2, -5], 'x', [0, 60_000]] });
        expect(sim.getTkSeries(NOW)).toEqual([{ ts: NOW - 4 * 60_000, tokens: 20_000 }, { ts: NOW, tokens: 60_000 }]);
    });

    it('clearAll drops every burn state', () => {
        sim.applyScenario({ usageHistory: { samples: [[0, 1, 2]] }, runsOut: { session: 5 }, paceDelta: 3, tkSeries: [[0, 1]] });
        sim.clearAll();
        expect([sim.getUsageHistory(NOW), sim.getRunsOut('session'), sim.getPaceDelta(), sim.getTkSeries(NOW)]).toEqual([null, null, null, null]);
    });
});
