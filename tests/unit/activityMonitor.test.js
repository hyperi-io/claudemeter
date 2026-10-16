import { describe, it, expect, vi } from 'vitest';
const { getActivityLevel, getActivityDescription, getStats } = require('../../src/activityMonitor');
const { ACTIVITY_DESCRIPTIONS } = require('../../src/activityQuotes');

describe('getActivityLevel', () => {
    it('returns idle for low usage', () => {
        expect(getActivityLevel({ usagePercent: 10 })).toBe('idle');
        expect(getActivityLevel({ usagePercent: 50 })).toBe('idle');
        expect(getActivityLevel({ usagePercent: 74 })).toBe('idle');
    });

    it('returns moderate for 75-89% usage', () => {
        expect(getActivityLevel({ usagePercent: 75 })).toBe('moderate');
        expect(getActivityLevel({ usagePercent: 89 })).toBe('moderate');
    });

    it('returns heavy for 90%+ usage', () => {
        expect(getActivityLevel({ usagePercent: 90 })).toBe('heavy');
        expect(getActivityLevel({ usagePercent: 100 })).toBe('heavy');
    });

    it('considers token usage', () => {
        const sessionData = { tokenUsage: { current: 950000, limit: 1000000 } };
        expect(getActivityLevel({ usagePercent: 0 }, sessionData)).toBe('heavy');
    });

    it('uses the higher of claude and token percent', () => {
        const sessionData = { tokenUsage: { current: 800000, limit: 1000000 } };
        expect(getActivityLevel({ usagePercent: 50 }, sessionData)).toBe('moderate');
    });

    it('handles null usage data', () => {
        expect(getActivityLevel(null)).toBe('idle');
        expect(getActivityLevel()).toBe('idle');
    });

    it('handles null session data', () => {
        expect(getActivityLevel({ usagePercent: 50 }, null)).toBe('idle');
    });
});

describe('getActivityDescription', () => {
    it('returns short and quirky for each level', () => {
        for (const level of ['heavy', 'moderate', 'idle']) {
            const desc = getActivityDescription(level);
            expect(desc).toHaveProperty('short');
            expect(desc).toHaveProperty('quirky');
            expect(typeof desc.short).toBe('string');
            expect(typeof desc.quirky).toBe('string');
            expect(desc.short.length).toBeGreaterThan(0);
            expect(desc.quirky.length).toBeGreaterThan(0);
        }
    });

    it('falls back to idle for unknown level', () => {
        const desc = getActivityDescription('unknown');
        expect(desc.short).toBe('Normal usage');
    });

    // A quip that changes per render changes the tooltip, and VS Code then
    // re-renders an open hover instead of letting it close.
    it('holds one quip across renders at the same level', () => {
        const first = getActivityDescription('idle').quirky;
        for (let i = 0; i < 50; i++) {
            expect(getActivityDescription('idle').quirky).toBe(first);
        }
    });

    it('picks from the new level when the level changes', () => {
        getActivityDescription('idle');
        const heavy = getActivityDescription('heavy').quirky;
        expect(ACTIVITY_DESCRIPTIONS.heavy.quirkyOptions).toContain(heavy);
    });

    it('keeps the quip at exactly five minutes and re-rolls after', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            const held = getActivityDescription('moderate').quirky;
            vi.advanceTimersByTime(5 * 60 * 1000);
            expect(getActivityDescription('moderate').quirky).toBe(held);

            const seen = new Set();
            for (let i = 0; i < 20; i++) {
                vi.advanceTimersByTime(5 * 60 * 1000 + 1);
                seen.add(getActivityDescription('moderate').quirky);
            }
            expect(seen.size).toBeGreaterThan(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('getStats', () => {
    it('returns complete stats object', () => {
        const stats = getStats({ usagePercent: 42 });
        expect(stats).toHaveProperty('level');
        expect(stats).toHaveProperty('claudePercent', 42);
        expect(stats).toHaveProperty('tokenPercent', 0);
        expect(stats).toHaveProperty('maxPercent', 42);
        expect(stats).toHaveProperty('description');
        expect(stats.description).toHaveProperty('short');
        expect(stats.description).toHaveProperty('quirky');
    });

    it('computes maxPercent from both sources', () => {
        const sessionData = { tokenUsage: { current: 600000, limit: 1000000 } };
        const stats = getStats({ usagePercent: 30 }, sessionData);
        expect(stats.claudePercent).toBe(30);
        expect(stats.tokenPercent).toBe(60);
        expect(stats.maxPercent).toBe(60);
    });

    it('handles null inputs gracefully', () => {
        const stats = getStats(null, null);
        expect(stats.claudePercent).toBe(0);
        expect(stats.tokenPercent).toBe(0);
        expect(stats.level).toBe('idle');
    });
});
