import { describe, it, expect, beforeEach } from 'vitest';
const sim = require('../../src/simulator');

describe('simulator — null returns to live, set/get/clear semantics', () => {
    beforeEach(() => sim.clearAll());

    it('returns null for every getter when nothing simulated', () => {
        expect(sim.getTokenLevel()).toBe(null);
        expect(sim.getTokenUsed()).toBe(null);
        expect(sim.getSessionPercent()).toBe(null);
        expect(sim.getWeeklyPercent()).toBe(null);
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
        sim.setHappyHour(true);
        sim.setColorMode('basic');
        sim.setProfileOverride('pro');

        sim.clearAll();

        expect(sim.getTokenLevel()).toBe(null);
        expect(sim.getTokenUsed()).toBe(null);
        expect(sim.getSessionPercent()).toBe(null);
        expect(sim.getWeeklyPercent()).toBe(null);
        expect(sim.getHappyHour()).toBe(null);
        expect(sim.getColorMode()).toBe(null);
        expect(sim.getProfileOverride()).toBe(null);
    });
});
