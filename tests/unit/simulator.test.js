import { describe, it, expect, beforeEach } from 'vitest';
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
